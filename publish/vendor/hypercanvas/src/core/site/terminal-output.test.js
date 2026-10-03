import { expect, it } from 'vitest'
import { formatSiteTerminalOutput } from './terminal-output.js'

it('renders real and split PTY color codes as readable text', () => {
  expect(formatSiteTerminalOutput([
    { stream: 'terminal', message: '\u001b[2m\u001b[34m[vite]\u001b[39m connected.\n' },
    { stream: 'terminal', message: '[2m[32mastro [39mready on http://localhost:4321/\r' },
  ])).toBe('[vite] connected.\n\nastro ready on http://localhost:4321/')
})

it('drops whitespace-only PTY rows before and after captured terminal output', () => {
  expect(formatSiteTerminalOutput([{ message: '\n  \n\t\n> astro dev\n  \n\t' }])).toBe('> astro dev')
})

it('normalizes CRLF blank rows before trimming captured terminal output', () => {
  expect(formatSiteTerminalOutput([{ message: '\r\n'.repeat(24) + '> astro dev\r\n' }])).toBe('> astro dev')
})

it('preserves indentation and blank rows around actual terminal output', () => {
  expect(formatSiteTerminalOutput([{ message: '\n  \n  > astro dev\n\n    ready\n  \n' }]))
    .toBe('  > astro dev\n\n    ready')
})
