import { describe, it, expect } from 'vitest'
import {
  parseFragments,
  extractFragment,
  applyFragments,
  stripLibraryMarkers,
} from './fragments.js'

// Helpers -------------------------------------------------------------------

function mkLookup(entries) {
  return (src, id) => {
    const key = `${src}:${id}`
    return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null
  }
}

const RUNTIME_BODY = '.storyboard/\n'

const CLIENT_GITIGNORE = `# top of file
/node_modules
.DS_Store

# <!-- storyboard:scaffold/gitignore:runtime-state --start-->
old-content
that-will-be-replaced
# <!-- storyboard:scaffold/gitignore:runtime-state --end-->

# bottom of file
`

const LIBRARY_GITIGNORE = `# packages/storyboard/scaffold/gitignore
/some/library/comment

# <!-- runtime-state --start-->
.storyboard/
# <!-- runtime-state --end-->

# trailing library comment
`

// parseFragments ------------------------------------------------------------

describe('parseFragments', () => {
  it('returns [] on a file with no markers', () => {
    expect(parseFragments('hello\nworld\n')).toEqual([])
  })

  it('returns [] on an empty string', () => {
    expect(parseFragments('')).toEqual([])
  })

  it('parses a single fragment with start/end on their own lines', () => {
    const out = parseFragments(CLIENT_GITIGNORE)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      sourcePath: 'scaffold/gitignore',
      id: 'runtime-state',
    })
    expect(out[0].body).toBe('old-content\nthat-will-be-replaced\n')
  })

  it('parses multiple fragments in the same file', () => {
    const text = [
      '# <!-- storyboard:scaffold/a:one --start-->',
      'A1',
      '# <!-- storyboard:scaffold/a:one --end-->',
      'middle',
      '# <!-- storyboard:scaffold/b:two --start-->',
      'B1',
      'B2',
      '# <!-- storyboard:scaffold/b:two --end-->',
      '',
    ].join('\n')
    const out = parseFragments(text)
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('one')
    expect(out[1].id).toBe('two')
    expect(out[1].body).toBe('B1\nB2\n')
  })

  it('handles an empty fragment body', () => {
    const text = [
      '# <!-- storyboard:src:id --start-->',
      '# <!-- storyboard:src:id --end-->',
      '',
    ].join('\n')
    const out = parseFragments(text)
    expect(out[0].body).toBe('')
  })

  it('rejects duplicate start without intervening end', () => {
    const text = [
      '# <!-- storyboard:src:id --start-->',
      'x',
      '# <!-- storyboard:src:id --start-->',
      '',
    ].join('\n')
    expect(() => parseFragments(text)).toThrow(/Duplicate or nested/)
  })

  it('rejects stray end with no matching start', () => {
    const text = [
      'a',
      '# <!-- storyboard:src:id --end-->',
      '',
    ].join('\n')
    expect(() => parseFragments(text)).toThrow(/Stray storyboard:src:id --end--/)
  })

  it('rejects unclosed start', () => {
    const text = [
      '# <!-- storyboard:src:id --start-->',
      'body',
      '',
    ].join('\n')
    expect(() => parseFragments(text)).toThrow(/Unclosed storyboard:src:id/)
  })

  it('ignores comment prefix style (works for #, //, <!--, etc.)', () => {
    const text = [
      '// <!-- storyboard:a:one --start-->',
      'x',
      '// <!-- storyboard:a:one --end-->',
      '<!-- storyboard:b:two --start-->',
      'y',
      '<!-- storyboard:b:two --end-->',
      '',
    ].join('\n')
    const out = parseFragments(text)
    expect(out).toHaveLength(2)
    expect(out.map(f => f.id)).toEqual(['one', 'two'])
  })

  it('handles CRLF line endings', () => {
    const text =
      '# <!-- storyboard:src:id --start-->\r\n' +
      'body\r\n' +
      '# <!-- storyboard:src:id --end-->\r\n'
    const out = parseFragments(text)
    expect(out).toHaveLength(1)
    expect(out[0].body).toBe('body\r\n')
  })
})

// extractFragment -----------------------------------------------------------

describe('extractFragment', () => {
  it('returns the body for a matching bare marker', () => {
    expect(extractFragment(LIBRARY_GITIGNORE, 'runtime-state')).toBe(RUNTIME_BODY)
  })

  it('returns null when the fragment id is not present', () => {
    expect(extractFragment(LIBRARY_GITIGNORE, 'nope')).toBeNull()
  })

  it('returns null on an empty source file', () => {
    expect(extractFragment('', 'whatever')).toBeNull()
  })

  it('handles an empty body', () => {
    const src = '<!-- empty --start-->\n<!-- empty --end-->\n'
    expect(extractFragment(src, 'empty')).toBe('')
  })

  it('rejects duplicate --start-- for the same id', () => {
    const src = [
      '<!-- dup --start-->',
      '<!-- dup --start-->',
      '<!-- dup --end-->',
      '',
    ].join('\n')
    expect(() => extractFragment(src, 'dup')).toThrow(/Duplicate --start--/)
  })

  it('rejects stray --end-- for the same id', () => {
    const src = '<!-- ghost --end-->\n'
    expect(() => extractFragment(src, 'ghost')).toThrow(/Stray --end--/)
  })

  it('rejects unclosed --start--', () => {
    const src = '<!-- open --start-->\nstuff\n'
    expect(() => extractFragment(src, 'open')).toThrow(/Unclosed --start--/)
  })

  it('ignores markers for other ids', () => {
    const src = [
      '<!-- other --start-->',
      'OTHER',
      '<!-- other --end-->',
      '<!-- target --start-->',
      'TARGET',
      '<!-- target --end-->',
      '',
    ].join('\n')
    expect(extractFragment(src, 'target')).toBe('TARGET\n')
  })
})

// applyFragments ------------------------------------------------------------

describe('applyFragments', () => {
  it('rewrites a single fragment body and reports replaced count', () => {
    const lookup = mkLookup({ 'scaffold/gitignore:runtime-state': RUNTIME_BODY })
    const out = applyFragments(CLIENT_GITIGNORE, lookup)
    expect(out.replaced).toBe(1)
    expect(out.unchanged).toBe(0)
    expect(out.text).toContain(RUNTIME_BODY)
    expect(out.text).not.toContain('old-content')
    // Outside-marker content preserved exactly
    expect(out.text).toContain('# top of file')
    expect(out.text).toContain('# bottom of file')
    expect(out.text.split('\n')[0]).toBe('# top of file')
  })

  it('is idempotent: applying twice produces the same text', () => {
    const lookup = mkLookup({ 'scaffold/gitignore:runtime-state': RUNTIME_BODY })
    const once = applyFragments(CLIENT_GITIGNORE, lookup).text
    const twice = applyFragments(once, lookup)
    expect(twice.text).toBe(once)
    expect(twice.replaced).toBe(0)
    expect(twice.unchanged).toBe(1)
  })

  it('returns text unchanged when there are no fragments', () => {
    const out = applyFragments('just some text\n', mkLookup({}))
    expect(out.text).toBe('just some text\n')
    expect(out.replaced).toBe(0)
  })

  it('throws when a fragment references an unknown source/id', () => {
    expect(() => applyFragments(CLIENT_GITIGNORE, mkLookup({}))).toThrow(
      /No fragment "runtime-state" found in scaffold\/gitignore/
    )
  })

  it('rewrites multiple fragments without index drift', () => {
    const text = [
      'header',
      '# <!-- storyboard:src:one --start-->',
      'OLD-ONE',
      '# <!-- storyboard:src:one --end-->',
      'middle',
      '# <!-- storyboard:src:two --start-->',
      'OLD-TWO-A',
      'OLD-TWO-B',
      '# <!-- storyboard:src:two --end-->',
      'footer',
      '',
    ].join('\n')
    const lookup = mkLookup({
      'src:one': 'NEW-ONE-A\nNEW-ONE-B\nNEW-ONE-C\n',
      'src:two': 'NEW-TWO\n',
    })
    const out = applyFragments(text, lookup)
    expect(out.replaced).toBe(2)
    expect(out.text).toContain('NEW-ONE-A\nNEW-ONE-B\nNEW-ONE-C\n')
    expect(out.text).toContain('NEW-TWO\n')
    expect(out.text).not.toContain('OLD-')
    expect(out.text.split('\n')[0]).toBe('header')
    expect(out.text).toMatch(/footer\n$/)
  })

  it('preserves CRLF line endings around the fragment', () => {
    const text =
      'header\r\n' +
      '# <!-- storyboard:src:id --start-->\r\n' +
      'OLD\r\n' +
      '# <!-- storyboard:src:id --end-->\r\n' +
      'footer\r\n'
    const out = applyFragments(text, mkLookup({ 'src:id': 'NEW\r\n' }))
    expect(out.text).toBe(
      'header\r\n' +
      '# <!-- storyboard:src:id --start-->\r\n' +
      'NEW\r\n' +
      '# <!-- storyboard:src:id --end-->\r\n' +
      'footer\r\n'
    )
  })

  it('counts unchanged fragments separately from replaced', () => {
    const text = [
      '# <!-- storyboard:src:one --start-->',
      'KEEP-ME',
      '# <!-- storyboard:src:one --end-->',
      '# <!-- storyboard:src:two --start-->',
      'OLD',
      '# <!-- storyboard:src:two --end-->',
      '',
    ].join('\n')
    const lookup = mkLookup({
      'src:one': 'KEEP-ME\n',
      'src:two': 'NEW\n',
    })
    const out = applyFragments(text, lookup)
    expect(out.replaced).toBe(1)
    expect(out.unchanged).toBe(1)
  })
})

// stripLibraryMarkers -------------------------------------------------------

describe('stripLibraryMarkers', () => {
  it('removes bare --start-- and --end-- marker lines', () => {
    const out = stripLibraryMarkers(LIBRARY_GITIGNORE)
    expect(out.stripped).toBe(2)
    expect(out.text).not.toMatch(/--start--/)
    expect(out.text).not.toMatch(/--end--/)
    expect(out.text).toContain('.storyboard/')
    expect(out.text).not.toContain('drafts/')
    expect(out.text).toContain('# trailing library comment')
  })

  it('leaves non-marker content untouched', () => {
    const text = 'a\nb\nc\n'
    const out = stripLibraryMarkers(text)
    expect(out.stripped).toBe(0)
    expect(out.text).toBe('a\nb\nc\n')
  })

  it('leaves storyboard:-namespaced markers intact (defensive)', () => {
    const text = [
      '# <!-- storyboard:scaffold/x:foo --start-->',
      'body',
      '# <!-- storyboard:scaffold/x:foo --end-->',
      '',
    ].join('\n')
    const out = stripLibraryMarkers(text)
    expect(out.stripped).toBe(0)
    expect(out.text).toBe(text)
  })

  it('collapses runs of blank lines left behind', () => {
    const text = [
      'first',
      '',
      '<!-- a --start-->',
      'body',
      '<!-- a --end-->',
      '',
      'last',
      '',
    ].join('\n')
    const out = stripLibraryMarkers(text)
    expect(out.stripped).toBe(2)
    // The two blank lines that bracketed the markers should collapse to one.
    expect(out.text.split('\n\n').length).toBeLessThanOrEqual(3)
    expect(out.text).toContain('first')
    expect(out.text).toContain('body')
    expect(out.text).toContain('last')
  })

  it('handles multiple bare fragments in one file', () => {
    const text = [
      '<!-- one --start-->',
      'A',
      '<!-- one --end-->',
      '<!-- two --start-->',
      'B',
      '<!-- two --end-->',
      '',
    ].join('\n')
    const out = stripLibraryMarkers(text)
    expect(out.stripped).toBe(4)
    expect(out.text).toContain('A')
    expect(out.text).toContain('B')
  })

  it('is idempotent', () => {
    const once = stripLibraryMarkers(LIBRARY_GITIGNORE).text
    const twice = stripLibraryMarkers(once)
    expect(twice.text).toBe(once)
    expect(twice.stripped).toBe(0)
  })
})

// Cross-function integration -----------------------------------------------

describe('integration: client.apply ↔ library.extract', () => {
  it('round-trips through apply + extract', () => {
    const lookup = (src, id) => {
      if (src === 'scaffold/gitignore') return extractFragment(LIBRARY_GITIGNORE, id)
      return null
    }
    const applied = applyFragments(CLIENT_GITIGNORE, lookup)
    const fragments = parseFragments(applied.text)
    expect(fragments).toHaveLength(1)
    expect(fragments[0].body).toBe(RUNTIME_BODY)
  })

  it('whole-file strip yields content equivalent to the fragment body for a single-fragment file', () => {
    // A trivial library file containing nothing but the fragment.
    const src = '<!-- only --start-->\nA\nB\n<!-- only --end-->\n'
    const stripped = stripLibraryMarkers(src).text
    const body = extractFragment(src, 'only')
    // Stripping leaves the body intact (plus the trailing newline that was
    // after the closing marker on its own line).
    expect(stripped).toContain(body)
  })
})
