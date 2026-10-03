import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(__dirname, 'terminal-welcome.js'), 'utf8')

// Agent CLIs run under the terminal PTY. An interactive child shell can be
// placed in a background process group and suspended on terminal output.
// Source ~/.zshrc explicitly so PATH shims from nvm/volta/asdf remain available.
describe('terminal-welcome: agent spawn shell flags', () => {
  it('uses -ilc (not -lc) for every agent shell command', () => {
    const spawnCalls = SOURCE.match(/spawn\(\s*runtime\.shell\s*,\s*\[[^\]]*\]/g) || []
    expect(spawnCalls.length).toBeGreaterThan(0)

    const commandCall = spawnCalls.find((call) => /-ilc['"]/.test(call))
    expect(commandCall).toBeDefined()
    expect(commandCall).toContain("'-ilc'")
    expect(commandCall.includes("'-lc'")).toBe(false)
  })

  it('resolves the agent executable before the login shell can reorder PATH', () => {
    expect(SOURCE).toContain('resolveStartupCommand(command, env)')
    expect(SOURCE).toContain("execFileSync('which', [match[1]]")
  })
})
