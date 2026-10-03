/**
 * Scaffold fragment templating — comment-style-agnostic block markers used by
 * `storyboard-scaffold` to keep slices of client-owned files in sync with the
 * library.
 *
 * Two marker schemes:
 *
 *   Client-side ("namespaced"):
 *     # <!-- storyboard:<source-path>:<fragment-id> --start-->
 *     ...content the scaffolder rewrites...
 *     # <!-- storyboard:<source-path>:<fragment-id> --end-->
 *
 *     The leading `#` (or `//`, or whatever comment prefix the host file uses)
 *     is ignored by the parser — we match on the `storyboard:` namespace
 *     substring only, so the same scheme works in .gitignore, .yml, .json,
 *     .js, .md, etc.
 *
 *   Library-side ("bare"):
 *     # <!-- <fragment-id> --start-->
 *     ...fragment body...
 *     # <!-- <fragment-id> --end-->
 *
 *     Bare markers live in `packages/storyboard/scaffold/<source-path>`. The
 *     scaffolder reads them via `extractFragment()`. When a library file is
 *     copied wholesale into a client (no client-side markers present), the
 *     scaffolder strips the bare markers first via `stripLibraryMarkers()`
 *     so the client gets clean content.
 *
 * Whitespace rules:
 *   - Fragment body = the bytes BETWEEN the start-marker line and the
 *     end-marker line, exclusive of both. Leading/trailing newlines on the
 *     body are preserved exactly so round-trips are stable.
 *   - The comment prefix on the start line is repeated on the end line by
 *     convention but not enforced — the parser only requires that both
 *     markers appear on their own line.
 *
 * Failure modes (all throw):
 *   - Nested markers with the same id.
 *   - Unbalanced markers (start without end, or vice versa).
 *   - Unknown source path or fragment id during apply.
 */

const NAMESPACE = 'storyboard'

// Captures `storyboard:<src>:<id> --start` or `--end` inside an HTML comment.
// The wrapping comment chars (`#`, `//`, etc.) AROUND the `<!--` are matched
// loosely — we only require the `<!--` HTML-comment open/close brackets and
// the `storyboard:` namespace substring.
const NAMESPACED_MARKER_RE = new RegExp(
  `<!--\\s*${NAMESPACE}:([^\\s:]+):([A-Za-z0-9][A-Za-z0-9-]*)\\s+--(start|end)\\s*-->`
)

// Library-side bare markers: `<!-- <id> --start-->` or `<!-- <id> --end-->`.
// `<!--` and `-->` are required so we don't accidentally match prose comments.
const BARE_MARKER_RE = /<!--\s*([A-Za-z0-9][A-Za-z0-9-]*)\s+--(start|end)\s*-->/

/**
 * @typedef {object} NamespacedFragment
 * @property {string} sourcePath  - e.g. "scaffold/gitignore"
 * @property {string} id          - e.g. "runtime-state"
 * @property {number} startLine   - 0-indexed line number of the start marker
 * @property {number} endLine     - 0-indexed line number of the end marker
 * @property {string} body        - content between markers (exclusive)
 */

/**
 * Parse a client-side file for `storyboard:<src>:<id>` fragment markers.
 *
 * @param {string} text
 * @returns {NamespacedFragment[]}
 * @throws if markers are nested, unbalanced, or duplicated.
 */
export function parseFragments(text) {
  const lines = splitLinesKeepingEol(text)
  const fragments = []
  const open = new Map() // key=`${src}:${id}` → { sourcePath, id, startLine }

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(NAMESPACED_MARKER_RE)
    if (!m) continue
    const [, sourcePath, id, side] = m
    const key = `${sourcePath}:${id}`

    if (side === 'start') {
      if (open.has(key)) {
        throw new Error(
          `Duplicate or nested storyboard:${key} --start-- marker at line ${i + 1}`
        )
      }
      open.set(key, { sourcePath, id, startLine: i })
    } else {
      const opened = open.get(key)
      if (!opened) {
        throw new Error(
          `Stray storyboard:${key} --end-- marker at line ${i + 1} with no matching --start--`
        )
      }
      const bodyLines = lines.slice(opened.startLine + 1, i)
      fragments.push({
        sourcePath: opened.sourcePath,
        id: opened.id,
        startLine: opened.startLine,
        endLine: i,
        body: bodyLines.join(''),
      })
      open.delete(key)
    }
  }

  if (open.size > 0) {
    const first = [...open.values()][0]
    throw new Error(
      `Unclosed storyboard:${first.sourcePath}:${first.id} fragment (start at line ${first.startLine + 1})`
    )
  }

  return fragments
}

/**
 * Extract a bare-marker fragment body from a library source file.
 *
 * @param {string} srcText
 * @param {string} id
 * @returns {string|null} the fragment body (between markers, exclusive), or
 *   null if no matching fragment exists.
 * @throws if markers are nested, unbalanced, or duplicated for the same id.
 */
export function extractFragment(srcText, id) {
  const lines = splitLinesKeepingEol(srcText)
  let startLine = -1

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(BARE_MARKER_RE)
    if (!m || m[1] !== id) continue
    const side = m[2]
    if (side === 'start') {
      if (startLine !== -1) {
        throw new Error(`Duplicate --start-- marker for fragment "${id}" at line ${i + 1}`)
      }
      startLine = i
    } else {
      if (startLine === -1) {
        throw new Error(`Stray --end-- marker for fragment "${id}" at line ${i + 1}`)
      }
      const bodyLines = lines.slice(startLine + 1, i)
      return bodyLines.join('')
    }
  }

  if (startLine !== -1) {
    throw new Error(`Unclosed --start-- marker for fragment "${id}" at line ${startLine + 1}`)
  }
  return null
}

/**
 * Rewrite the bodies of every `storyboard:<src>:<id>` fragment in a client
 * file by looking up the matching library fragment via `lookup(src, id)`.
 *
 * The lookup callback is responsible for resolving the source file and
 * extracting the fragment body — typically:
 *
 *   (src, id) => extractFragment(fs.readFileSync(src, 'utf-8'), id)
 *
 * Returns `{ text, replaced, unchanged }` so the caller can report counts and
 * skip writes when nothing changed.
 *
 * @param {string} clientText
 * @param {(sourcePath: string, fragmentId: string) => string|null} lookup
 * @returns {{ text: string, replaced: number, unchanged: number }}
 * @throws if a fragment marker references a source/id the lookup can't resolve.
 */
export function applyFragments(clientText, lookup) {
  const fragments = parseFragments(clientText)
  if (fragments.length === 0) {
    return { text: clientText, replaced: 0, unchanged: 0 }
  }

  const lines = splitLinesKeepingEol(clientText)
  let replaced = 0
  let unchanged = 0

  // Walk fragments in reverse so earlier indices don't shift after splicing.
  for (let i = fragments.length - 1; i >= 0; i--) {
    const frag = fragments[i]
    const newBody = lookup(frag.sourcePath, frag.id)
    if (newBody == null) {
      throw new Error(
        `No fragment "${frag.id}" found in ${frag.sourcePath} (referenced from client line ${frag.startLine + 1})`
      )
    }

    const newBodyLines = splitLinesKeepingEol(newBody)
    const oldBody = lines.slice(frag.startLine + 1, frag.endLine).join('')
    if (oldBody === newBody) {
      unchanged++
      continue
    }

    lines.splice(frag.startLine + 1, frag.endLine - frag.startLine - 1, ...newBodyLines)
    replaced++
  }

  return { text: lines.join(''), replaced, unchanged }
}

/**
 * Strip library-side bare markers from a text. Used by the whole-file copy
 * pass so that when a library file is copied into a client, the markers
 * don't leak through.
 *
 * Defensive behaviour:
 *   - Removes ONLY bare-marker lines (`<!-- <id> --start-->` / `--end-->`).
 *   - Leaves `storyboard:<src>:<id>` namespaced markers in place — those
 *     don't belong in library sources, but if a contributor adds one we
 *     shouldn't silently delete it.
 *   - Collapses any blank lines left behind so the output stays clean.
 *
 * @param {string} text
 * @returns {{ text: string, stripped: number }} number of marker LINES removed.
 */
export function stripLibraryMarkers(text) {
  const lines = splitLinesKeepingEol(text)
  let stripped = 0

  const filtered = lines.filter((line) => {
    if (NAMESPACED_MARKER_RE.test(line)) return true

    const m = line.match(BARE_MARKER_RE)
    if (!m) return true

    stripped++
    return false
  })

  // Collapse runs of >2 consecutive blank lines that may now exist where
  // a marker used to live.
  const collapsed = []
  let blankRun = 0
  for (const line of filtered) {
    const isBlank = /^\s*$/.test(stripEol(line))
    if (isBlank) {
      blankRun++
      if (blankRun > 1) continue
    } else {
      blankRun = 0
    }
    collapsed.push(line)
  }

  return { text: collapsed.join(''), stripped }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Split text into an array of lines that, when joined, reproduce the input
 * byte-for-byte. Each element retains its trailing `\n` / `\r\n` (or no EOL
 * for a trailing non-terminated line).
 *
 * This is the only safe way to splice line ranges back together without
 * mangling line endings — a naive `split('\n').join('\n')` corrupts CRLF
 * files and drops the trailing newline.
 */
function splitLinesKeepingEol(text) {
  if (text === '') return []
  const out = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') {
      out.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < text.length) {
    out.push(text.slice(start))
  }
  return out
}

function stripEol(line) {
  return line.replace(/\r?\n$/, '')
}
