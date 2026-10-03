/**
 * Agent Session — capture & resume per-widget agent CLI sessions.
 *
 * Copilot CLI doesn't accept a `--settings` arg the way Claude Code does —
 * its hooks are loaded from `~/.copilot/hooks/*.json` (and `.github/hooks/`
 * + a few other locations). We install a single user-level hook file once
 * that runs on `sessionStart` for every copilot invocation; the hook reads
 * `STORYBOARD_WIDGET_ID` from its env (we already export it into the agent
 * shell) and the JSON payload from stdin, then writes the captured
 * `sessionId` to a per-widget capture file under the widget's project root.
 *
 * A watcher on the per-widget capture file persists the captured id onto
 * the widget's terminal config as `lastAgentSessionId`. On the next cold
 * restart, the launch is rewritten to `copilot --resume=<id> --agent ...`
 * (with a pre-flight check that the on-disk session still exists), and is
 * shell-chained with a `|| <fresh-startup>` fallback so that if the agent
 * CLI rejects the id at runtime the widget still ends up with a working
 * fresh session instead of a dead terminal.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, watch as fsWatch, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const CAPTURE_DIR = join('.storyboard', 'agent-sessions')
const COPILOT_USER_HOOKS_DIR = join(homedir(), '.copilot', 'hooks')
const COPILOT_HOOK_FILENAME = 'storyboard-capture.json'
const COPILOT_SESSION_STATE_DIR = join(homedir(), '.copilot', 'session-state')
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json')
const CLAUDE_HOOK_MARKER = 'storyboard-capture'
const CODEX_HOOKS_PATH = join(homedir(), '.codex', 'hooks.json')

/** Resolve absolute path to the per-widget capture directory under root. */
function captureDir(root) {
  const dir = join(root, CAPTURE_DIR)
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }) } catch { /* empty */ }
  }
  return dir
}

/** Path to the per-widget capture file written by the user-level hook. */
export function captureFilePath(root, widgetKey) {
  return join(captureDir(root), `${widgetKey}.session-id`)
}

/**
 * Install (idempotently) a user-level Copilot CLI hook that captures the
 * session id of every storyboard-managed widget into a per-widget file.
 *
 * The hook fires on `sessionStart` (both new + resume), reads:
 *   - `STORYBOARD_WIDGET_ID` from env (exported by terminal-server)
 *   - `STORYBOARD_PROJECT_ROOT` from env (we export this too — see below)
 *   - `sessionId` from the hook's JSON stdin payload
 * and writes the sessionId to
 *   `$STORYBOARD_PROJECT_ROOT/.storyboard/agent-sessions/$STORYBOARD_WIDGET_ID.session-id`.
 *
 * If either env var is missing (e.g. user runs copilot outside storyboard),
 * the hook silently no-ops.
 *
 * Safe to call on every dev-server boot.
 */
export function ensureCopilotCaptureHookInstalled() {
  try { mkdirSync(COPILOT_USER_HOOKS_DIR, { recursive: true }) } catch { /* empty */ }

  const hookPath = join(COPILOT_USER_HOOKS_DIR, COPILOT_HOOK_FILENAME)

  const hook = {
    version: 1,
    hooks: {
      sessionStart: [
        { type: 'command', bash: buildCaptureBashScript(), timeoutSec: 5 },
      ],
    },
  }

  // Only rewrite if content changed, to avoid unnecessary fs churn.
  let existing = null
  try { existing = readFileSync(hookPath, 'utf8') } catch { /* missing */ }
  const next = JSON.stringify(hook, null, 2) + '\n'
  if (existing !== next) {
    try { writeFileSync(hookPath, next) } catch { /* best-effort */ }
  }
  return hookPath
}

/**
 * Install (idempotently) a SessionStart hook in `~/.claude/settings.json`
 * that captures Claude Code session ids the same way the Copilot hook does.
 *
 * Claude's hook payload uses `session_id` (snake_case) instead of Copilot's
 * `sessionId` — our capture script handles both. Claude reads the hook from
 * `~/.claude/settings.json` and merges it with project / local / managed
 * settings, so we install user-scope and let Claude do the merging.
 *
 * Existing settings are preserved: we read, deep-merge our hook into the
 * SessionStart array (replacing any prior storyboard hook by `command`
 * marker), and write back.
 *
 * Safe to call on every dev-server boot.
 */
export function ensureClaudeCaptureHookInstalled() {
  let settings = {}
  try {
    settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'))
  } catch { /* file may not exist or be invalid — start fresh */ }

  if (typeof settings !== 'object' || settings === null) settings = {}
  if (typeof settings.hooks !== 'object' || settings.hooks === null) settings.hooks = {}
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = []

  const ourHandler = {
    type: 'command',
    command: buildCaptureBashScript(),
    timeout: 5,
  }
  // Claude wraps handlers in a matcher group. Use no matcher (matches all).
  const ourGroup = { hooks: [ourHandler] }

  // Replace any prior storyboard-capture group; identify by marker substring.
  const next = settings.hooks.SessionStart.filter((g) => {
    const handlers = Array.isArray(g?.hooks) ? g.hooks : []
    return !handlers.some((h) => typeof h?.command === 'string' && h.command.includes(CLAUDE_HOOK_MARKER))
  })
  // Tag our handler command with the marker so we can find/replace it later.
  ourHandler.command = `# ${CLAUDE_HOOK_MARKER}\n${ourHandler.command}`
  next.push(ourGroup)

  settings.hooks.SessionStart = next

  try { mkdirSync(join(homedir(), '.claude'), { recursive: true }) } catch { /* empty */ }
  try {
    writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n')
  } catch { /* best-effort */ }
  return CLAUDE_SETTINGS_PATH
}

/**
 * Install (idempotently) a SessionStart hook for Codex CLI at
 * `~/.codex/hooks.json` using the same shared capture script.
 *
 * Codex's hook format is JSON with PascalCase event names like Claude's
 * (and uses `session_id` snake_case in the payload, also like Claude).
 * We own this file end-to-end (Codex merges multiple hook sources, so
 * other hooks the user has via config.toml or repo-level files keep
 * working). The marker comment identifies our handler for replace.
 */
export function ensureCodexCaptureHookInstalled() {
  let hooks = { hooks: { SessionStart: [] } }
  try {
    const existing = JSON.parse(readFileSync(CODEX_HOOKS_PATH, 'utf8'))
    if (existing && typeof existing === 'object') hooks = existing
  } catch { /* file may not exist — start fresh */ }

  if (typeof hooks.hooks !== 'object' || hooks.hooks === null) hooks.hooks = {}
  if (!Array.isArray(hooks.hooks.SessionStart)) hooks.hooks.SessionStart = []

  const ourHandler = {
    type: 'command',
    command: `# ${CLAUDE_HOOK_MARKER}\n${buildCaptureBashScript()}`,
    timeout: 5,
  }
  // Codex matchers for SessionStart: "startup", "resume", "clear" — match all
  const ourGroup = { matcher: '*', hooks: [ourHandler] }

  hooks.hooks.SessionStart = hooks.hooks.SessionStart.filter((g) => {
    const handlers = Array.isArray(g?.hooks) ? g.hooks : []
    return !handlers.some((h) => typeof h?.command === 'string' && h.command.includes(CLAUDE_HOOK_MARKER))
  })
  hooks.hooks.SessionStart.push(ourGroup)

  try { mkdirSync(join(homedir(), '.codex'), { recursive: true }) } catch { /* empty */ }
  try {
    writeFileSync(CODEX_HOOKS_PATH, JSON.stringify(hooks, null, 2) + '\n')
  } catch { /* best-effort */ }
  return CODEX_HOOKS_PATH
}

/**
 * Shared capture bash script. Handles both Copilot (`sessionId` camelCase)
 * and Claude (`session_id` snake_case) payload shapes. Reads
 * STORYBOARD_WIDGET_ID + STORYBOARD_PROJECT_ROOT from env (exported by
 * terminal-server into the agent shell). Silently no-ops if either env
 * var is missing.
 */
function buildCaptureBashScript() {
  return [
    'wid="${STORYBOARD_WIDGET_ID}"',
    'root="${STORYBOARD_PROJECT_ROOT}"',
    '[ -z "$wid" ] && exit 0',
    '[ -z "$root" ] && exit 0',
    'payload=$(cat)',
    'id=$(printf %s "$payload" | sed -n \'s/.*"sessionId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -n1)',
    '[ -z "$id" ] && id=$(printf %s "$payload" | sed -n \'s/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -n1)',
    'dir="$root/.storyboard/agent-sessions"',
    'mkdir -p "$dir" 2>/dev/null',
    // Always touch the readiness marker — sessionStart fires only once
    // the agent is fully loaded and the prompt input is interactive, so
    // this is a much more reliable signal than the pre-agent shell echo.
    'touch "$root/.storyboard/terminals/$wid.ready" 2>/dev/null',
    '[ -z "$id" ] && exit 0',
    'printf %s "$id" > "$dir/$wid.session-id"',
  ].join('; ')
}

/**
 * Build a resume-aware startup command for an agent.
 *
 * Pre-validates that a captured `sessionId` looks like a UUID AND that the
 * session-state directory still exists for it under `~/.copilot/session-state/`.
 * If validation fails, returns the original `startupCommand` unchanged so
 * the agent launches a fresh session — same UX as today.
 *
 * Otherwise returns `agentCfg.resumeCommand` with `{id}` substituted. The
 * resume command is the FULL command to run (including the binary, the
 * --agent flag, and any other startup args), not just the resume flag —
 * keeping it in one field avoids confusion about which args go where.
 */
export function buildResumeStartupCommand({ startupCommand, sessionId, agentCfg }) {
  if (!startupCommand) return startupCommand

  const notice = `printf '\\n\\033[33m[storyboard] resume failed; starting fresh session...\\033[0m\\n'`
  const lastCmd = agentCfg?.resumeLastCommand

  // Chain: stored-id resume → resumeLastCommand (if any) → fresh startupCommand.
  // Each step's non-zero exit cascades to the next via shell `||`. Note: if a
  // resume hangs (vs. exits non-zero), the chain won't progress — users
  // should use the widget's restart button. We deliberately don't wrap in a
  // timeout to avoid killing slow-starting agents on flaky networks.
  const wrapFallback = (cmd) => {
    if (agentCfg?.resumeFallback === false) return cmd
    const last = lastCmd ? `${lastCmd} || { ${notice}; ${startupCommand}; }` : `${notice}; ${startupCommand}`
    return `${cmd} || { ${last}; }`
  }

  // Primary: per-widget captured sessionId → `resumeCommand` with {id}.
  if (sessionId && UUID_RE.test(sessionId)) {
    const template = agentCfg?.resumeCommand
    if (template && template.includes('{id}')) {
      return wrapFallback(template.replace('{id}', sessionId))
    }
  }

  // No id stored — try resumeLastCommand (e.g. `--continue` / `resume --last`),
  // falling through to fresh startupCommand if it exits non-zero.
  if (lastCmd) {
    if (agentCfg?.resumeFallback === false) return lastCmd
    return `${lastCmd} || { ${notice}; ${startupCommand}; }`
  }

  return startupCommand
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Decide whether a captured sessionId is still resumable.
 *
 * Strategies:
 *   - `agentCfg.sessionStateDir` → check if `<dir>/<id>` exists (Copilot)
 *   - `agentCfg.sessionStateGlob` → check if any
 *     `~/.claude/projects/*‍/<id>.jsonl` exists (Claude)
 *   - both null → trust the UUID
 *
 * Defaults to the Copilot session-state dir when nothing is configured.
 */
export function isResumableSessionId(sessionId, agentCfg = {}) {
  if (!sessionId) return false
  if (!UUID_RE.test(sessionId)) return false

  // Explicit glob check (Claude-style: <dir>/*/<id>.jsonl)
  if (agentCfg.sessionStateGlob) {
    return matchesSessionStateGlob(sessionId, agentCfg.sessionStateGlob)
  }

  const stateDir = agentCfg.sessionStateDir === undefined
    ? COPILOT_SESSION_STATE_DIR
    : agentCfg.sessionStateDir
  if (!stateDir) return true // explicit opt-out of fs validation
  return existsSync(join(stateDir, sessionId))
}

/**
 * Check if `<root>/<anySubdir>/<id>.jsonl` exists, where `glob` is a
 * shorthand string. Supports two forms:
 *   - `<root>/*` + `/{id}.jsonl` — exactly one subdir level (Claude pattern)
 *   - `<root>/**` + `/<name-with-{id}>` — recursive find (Codex pattern, where
 *     sessions are nested under year/month/day and the id is embedded in
 *     a longer filename like `rollout-<ts>-<id>.jsonl`)
 */
function matchesSessionStateGlob(sessionId, glob) {
  const expanded = glob.replace('~', homedir()).replace(/\{id\}/g, sessionId)

  // Recursive form: root/**/name
  if (expanded.includes('/**/')) {
    const [root, namePattern] = expanded.split('/**/')
    if (!existsSync(root)) return false
    try {
      const out = execFileSync('find', [root, '-name', namePattern, '-print', '-quit'], {
        encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
      })
      return out.trim().length > 0
    } catch { return false }
  }

  // Single-level form: root/*/suffix
  const parts = expanded.split('/*/')
  if (parts.length !== 2) {
    // Plain path with no wildcard — direct check.
    return existsSync(expanded)
  }
  const [root, suffix] = parts
  let entries = []
  try { entries = readdirSync(root) } catch { return false }
  for (const name of entries) {
    const full = join(root, name)
    try {
      if (!statSync(full).isDirectory()) continue
    } catch { continue }
    if (existsSync(join(full, suffix))) return true
  }
  return false
}

/**
 * Watch `captureFile` for the agent's session id and call `onCapture(id)`
 * once it appears or is updated. Unlike the previous one-shot version,
 * this keeps watching so subsequent sessions on the same widget (e.g.
 * after `/new` inside the agent) overwrite the captured id.
 *
 * Returns a `stop()` function the caller can invoke to cancel.
 */
export function watchSessionIdFile(captureFile, onCapture, { pollMs = 1500 } = {}) {
  let stopped = false
  let watcher = null
  let pollTimer = null
  let lastSeen = null

  const tryRead = () => {
    if (stopped) return
    try {
      if (!existsSync(captureFile)) return
      const id = readFileSync(captureFile, 'utf8').trim()
      if (!id || id === lastSeen) return
      lastSeen = id
      try { onCapture(id) } catch { /* empty */ }
    } catch { /* empty */ }
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    if (watcher) { try { watcher.close() } catch { /* empty */ } }
    if (pollTimer) clearInterval(pollTimer)
  }

  // Try once immediately
  tryRead()

  try {
    const dir = join(captureFile, '..')
    watcher = fsWatch(dir, () => tryRead())
  } catch { /* fall through to polling */ }

  pollTimer = setInterval(tryRead, pollMs)
  return stop
}

/**
 * Read a previously-captured session id from a capture file. Returns null
 * if the file is missing or empty.
 */
export function readCapturedSessionId(captureFile) {
  try {
    if (!existsSync(captureFile)) return null
    const id = readFileSync(captureFile, 'utf8').trim()
    return id || null
  } catch { return null }
}

/**
 * Remove a capture file (e.g. after a widget is deleted). Best-effort.
 */
export function clearCaptureFile(captureFile) {
  try { unlinkSync(captureFile) } catch { /* empty */ }
}
