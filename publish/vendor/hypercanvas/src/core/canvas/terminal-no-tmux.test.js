import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const canvasDir = dirname(fileURLToPath(import.meta.url))
const coreDir = resolve(canvasDir, '..')
const packageDir = resolve(coreDir, '..', '..')

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : javascriptFiles(path)
    return /\.(js|jsx)$/.test(entry.name) && !entry.name.endsWith('.test.js') ? [path] : []
  })
}

describe('terminal runtime dependencies', () => {
  it('has no active tmux command or node-pty import path', () => {
    const files = javascriptFiles(coreDir)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/(?:execSync|execFileSync|spawn)\s*\(\s*[`'"]tmux\b/)
      expect(source, file).not.toContain("import('node-pty')")
      expect(source, file).not.toContain("from 'node-pty'")
    }
  })

  it('does not package node-pty', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    expect(manifest.dependencies?.['node-pty']).toBeUndefined()
    expect(manifest.optionalDependencies?.['node-pty']).toBeUndefined()
  })
})
