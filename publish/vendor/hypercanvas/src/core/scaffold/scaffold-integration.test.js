import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

/**
 * End-to-end scaffold tests: spawn the real `storyboard-scaffold` binary
 * against a tmp client directory and assert the file outcomes match the
 * design rules from `.agents/plans/scaffold-fragment-templating.md`.
 *
 * This validates the full pipeline (config → file pass → fragments pass +
 * migration helper + library-marker stripping), not just the individual
 * pure functions covered by `fragments.test.js`.
 */

const SCAFFOLD_BIN = path.resolve(
  // From packages/storyboard/src/core/scaffold/scaffold-integration.test.js
  path.dirname(new URL(import.meta.url).pathname),
  '..', 'scaffold.js'
)

function runScaffolder(cwd, args = []) {
  return execFileSync(process.execPath, [SCAFFOLD_BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

let tmp

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-scaffold-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('storyboard-scaffold integration', () => {
  it('fresh client: copies whole files and strips library markers from the output', () => {
    runScaffolder(tmp)

    const gitignore = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8')

    // Library-side bare markers must NOT leak into the client output.
    expect(gitignore).not.toMatch(/<!--\s+runtime-state\s+--start-->/)
    expect(gitignore).not.toMatch(/<!--\s+runtime-state\s+--end-->/)

    // The fragment body content should be present.
    expect(gitignore).toContain('.storyboard/')
    expect(gitignore).toContain('src/canvas/**/drafts/')
    expect(gitignore).toContain('src/prototypes/**/drafts/')
    // The drafts image dir is also gitignored — second privacy layer for
    // canvas images that belong to a draft canvas.
    expect(gitignore).toContain('assets/canvas/images/drafts/')
  })

  it('fresh client: scaffolds every domain config used by the runtime', () => {
    runScaffolder(tmp)

    for (const filename of [
      'storyboard.config.json',
      'toolbar.config.json',
      'commandpalette.config.json',
      'paste.config.json',
      'widgets.config.json',
      'terminal.config.json',
      'mascot.config.json',
    ]) {
      expect(fs.existsSync(path.join(tmp, filename))).toBe(true)
    }

    const terminal = JSON.parse(fs.readFileSync(path.join(tmp, 'terminal.config.json'), 'utf-8'))
    expect(terminal.agents?.copilot?.startupCommand).toBeTruthy()
  })

  it('re-run on a fresh client is a no-op (idempotent)', () => {
    runScaffolder(tmp)
    const before = snapshot(tmp)
    runScaffolder(tmp)
    const after = snapshot(tmp)
    expect(after).toEqual(before)
  })

  it('client with explicit fragment markers: rewrites only the fragment body', () => {
    // Hand-craft a client .gitignore that has its own header + a marker block
    // pointing at the library fragment with stale content inside.
    const clientGitignore = [
      '# my custom header',
      '/node_modules',
      '',
      '# <!-- storyboard:scaffold/gitignore:runtime-state --start-->',
      'STALE-CONTENT-THAT-MUST-BE-REPLACED',
      '# <!-- storyboard:scaffold/gitignore:runtime-state --end-->',
      '',
      '# my custom footer',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(tmp, '.gitignore'), clientGitignore, 'utf-8')

    runScaffolder(tmp, ['--fragments-only'])

    const updated = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8')

    // Outside-marker content preserved exactly.
    expect(updated).toContain('# my custom header')
    expect(updated).toContain('# my custom footer')
    expect(updated).toContain('/node_modules')

    // Fragment body rewritten.
    expect(updated).not.toContain('STALE-CONTENT-THAT-MUST-BE-REPLACED')
    expect(updated).toContain('.storyboard/')

    // Client markers stay so the next scaffold can keep things in sync.
    expect(updated).toContain('storyboard:scaffold/gitignore:runtime-state --start')
    expect(updated).toContain('storyboard:scaffold/gitignore:runtime-state --end')
  })

  it('client with unknown fragment id: exits non-zero with a clear error', () => {
    const clientGitignore = [
      '# <!-- storyboard:scaffold/gitignore:does-not-exist --start-->',
      'x',
      '# <!-- storyboard:scaffold/gitignore:does-not-exist --end-->',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(tmp, '.gitignore'), clientGitignore, 'utf-8')

    let threw = false
    let errOutput = ''
    try {
      runScaffolder(tmp, ['--fragments-only'])
    } catch (err) {
      threw = true
      errOutput = String(err.stderr || '') + String(err.stdout || '')
    }

    expect(threw).toBe(true)
    expect(errOutput).toMatch(/No fragment "does-not-exist"/)
  })

  it('legacy ad-hoc gitignore banner is migrated into marker form', () => {
    // Mimic what setup.js used to append in pre-0.6.10 clients.
    const legacy = [
      '# my header',
      '/node_modules',
      '',
      '# Storyboard: runtime state (gitignored) + private tilde-prefixed files',
      '.storyboard/',
      'src/canvas/images/~*',
      'assets/canvas/images/~*',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(tmp, '.gitignore'), legacy, 'utf-8')

    runScaffolder(tmp, ['--fragments-only'])

    const updated = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8')

    // Header preserved.
    expect(updated).toContain('# my header')
    expect(updated).toContain('/node_modules')

    // Markers now present.
    expect(updated).toContain('storyboard:scaffold/gitignore:runtime-state --start')
    expect(updated).toContain('storyboard:scaffold/gitignore:runtime-state --end')

    // Legacy banner gone.
    expect(updated).not.toContain('# Storyboard: runtime state (gitignored) + private tilde-prefixed files')

    // Fragment body matches the library.
    expect(updated).toContain('src/canvas/**/drafts/')

    // Second run is a no-op.
    const before = updated
    runScaffolder(tmp, ['--fragments-only'])
    const after = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8')
    expect(after).toBe(before)
  })

  it('strips storyboard-managed orphan lines left outside the marker block', () => {
    // A client whose marker block already exists, but that still carries the
    // pre-fragment whole-file scaffold lines outside it (removed from / moved
    // into the library since). On scaffold those orphans should be cleaned.
    const client = [
      '# misc',
      '.DS_Store',
      '',
      '.github/skills/_archive',
      '.github/skills/playwright-cli',
      '# Agent symlinks are build targets — source of truth is .agents/agents/',
      '# storyboard setup creates symlinks for Copilot CLI and Claude Code',
      '.github/agents/_buddy.md',
      '.github/agents/prompt-agent.md',
      '.claude/agents/',
      '_*.md',
      '',
      '# <!-- storyboard:scaffold/gitignore:runtime-state --start-->',
      'STALE',
      '# <!-- storyboard:scaffold/gitignore:runtime-state --end-->',
      '',
      '# my own rule',
      'secret/',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(tmp, '.gitignore'), client, 'utf-8')

    runScaffolder(tmp, ['--fragments-only'])

    const updated = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8')
    const lines = updated.split('\n')
    const startIdx = lines.findIndex((l) => l.includes('runtime-state --start'))
    const endIdx = lines.findIndex((l) => l.includes('runtime-state --end'))
    const outside = [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)]

    // Removed-tier orphans gone everywhere.
    expect(updated).not.toContain('.github/skills/_archive')
    expect(updated).not.toContain('.github/skills/playwright-cli')
    expect(updated).not.toContain('.github/agents/_buddy.md')
    expect(updated).not.toContain('# Agent symlinks are build targets')

    // Absorbed-tier orphans removed from outside, kept inside the block.
    expect(outside).not.toContain('.claude/agents/')
    expect(outside).not.toContain('_*.md')
    expect(lines.slice(startIdx + 1, endIdx)).toContain('.claude/agents/')

    // Block synced + user content preserved.
    expect(updated).not.toContain('STALE')
    expect(updated).toContain('.storyboard/')
    expect(updated).toContain('.DS_Store')
    expect(updated).toContain('secret/')
    // No blank-line runs introduced.
    expect(updated).not.toMatch(/\n\n\n/)

    // Idempotent.
    const before = updated
    runScaffolder(tmp, ['--fragments-only'])
    expect(fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8')).toBe(before)
  })

  it('legacy split-form gitignore (Runtime + Private headers) is migrated into marker form', () => {
    // Mimic a client that received the pre-fragment scaffold/gitignore where
    // runtime state and private images lived in two separate sections.
    const legacy = [
      '# my header',
      '/node_modules',
      '',
      '# Runtime/transient state (per-machine, per-session)',
      '.storyboard/agent-sessions/',
      '.storyboard/hot-pool/',
      '.storyboard/logs/',
      '',
      '# Private canvas images (tilde prefix = not committed)',
      'src/canvas/images/~*',
      'assets/canvas/images/~*',
      '.sync-target',
      '',
      '# Integration test results (ephemeral local artifacts)',
      'test-results/',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(tmp, '.gitignore'), legacy, 'utf-8')

    runScaffolder(tmp, ['--fragments-only'])

    const updated = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8')

    // Header preserved.
    expect(updated).toContain('# my header')
    // Unrelated section (test-results) preserved.
    expect(updated).toContain('# Integration test results (ephemeral local artifacts)')
    expect(updated).toContain('test-results/')

    // Both legacy section headers gone.
    expect(updated).not.toContain('# Runtime/transient state (per-machine, per-session)')
    expect(updated).not.toContain('# Private canvas images (tilde prefix = not committed)')

    // Marker block present with library body.
    expect(updated).toContain('storyboard:scaffold/gitignore:runtime-state --start')
    expect(updated).toContain('src/canvas/**/drafts/')

    // Second run is a no-op.
    const before = updated
    runScaffolder(tmp, ['--fragments-only'])
    const after = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8')
    expect(after).toBe(before)
  })

  it('--files-only skips the fragment pass entirely', () => {
    // Seed a gitignore with a stale fragment body. --files-only should NOT
    // touch it because the fragment-replace pass is suppressed.
    const stale = [
      '# <!-- storyboard:scaffold/gitignore:runtime-state --start-->',
      'STALE',
      '# <!-- storyboard:scaffold/gitignore:runtime-state --end-->',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(tmp, '.gitignore'), stale, 'utf-8')

    runScaffolder(tmp, ['--files-only'])

    const after = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8')
    expect(after).toContain('STALE')
  })

  it('force-syncs the package-owned base set onto a fresh client', () => {
    runScaffolder(tmp)

    // Tier-1 infra configs land (iron-clad base — customers never edit these).
    for (const f of ['vite.config.js', 'vitest.config.js', 'eslint.config.js', 'tsconfig.json']) {
      expect(fs.existsSync(path.join(tmp, f)), `${f} should be scaffolded`).toBe(true)
    }
    // The new `home` library surface lands so /-resolution works everywhere.
    expect(fs.existsSync(path.join(tmp, 'src/library/home.jsx'))).toBe(true)
    // No svelte stub is ever scaffolded.
    expect(fs.existsSync(path.join(tmp, 'svelte.config.js'))).toBe(false)
    // The scaffolded eslint config carries no svelte reference.
    expect(fs.readFileSync(path.join(tmp, 'eslint.config.js'), 'utf-8')).not.toContain('svelte')
  }, 20000)

  it('overwrites a customer-modified vite.config.js (updateable = force-sync)', () => {
    runScaffolder(tmp)
    const vitePath = path.join(tmp, 'vite.config.js')
    const pristine = fs.readFileSync(vitePath, 'utf-8')
    fs.writeFileSync(vitePath, '// customer tampering\n', 'utf-8')
    runScaffolder(tmp)
    expect(fs.readFileSync(vitePath, 'utf-8')).toBe(pristine)
  }, 20000)
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function snapshot(dir) {
  const out = {}
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        out[path.relative(dir, full)] = fs.readFileSync(full, 'utf-8')
      }
    }
  }
  walk(dir)
  return out
}
