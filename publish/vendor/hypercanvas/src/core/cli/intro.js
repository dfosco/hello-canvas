/**
 * Single source of truth for CLI getting-started content.
 * Used by both `storyboard setup` and the help screen (`storyboard`).
 */

// ANSI helpers — shared across CLI modules
export const dim = (s) => `\x1b[2m${s}\x1b[0m`
export const magenta = (s) => `\x1b[35m${s}\x1b[0m`
export const cyan = (s) => `\x1b[36m${s}\x1b[0m`
export const green = (s) => `\x1b[32m${s}\x1b[0m`
export const bold = (s) => `\x1b[1m${s}\x1b[0m`
export const white = (s) => `\x1b[97m${s}\x1b[0m`
export const yellow = (s) => `\x1b[33m${s}\x1b[0m`

/**
 * Returns the getting-started intro lines as an array of strings.
 * @param {object} [opts]
 * @param {string} [opts.indent='  '] Prefix for each non-empty line
 */
export function gettingStartedLines({ indent = '  ' } = {}) {
  const i = indent
  return [
    `${i}Welcome! Storyboard is a design tool to build and`,
    `${i}collaborate on prototypes. Here's how to get started:`,
    '',
    `${i}  ${green('npx storyboard dev')}                Start developing locally`,
    `${i}  ${green('npx storyboard create prototype')}   Create a prototype`,
    `${i}  ${green('npx storyboard create canvas')}      Create a canvas`,
    `${i}  ${green('npx storyboard create component')}   Create a component (.story.jsx)`,
    `${i}  ${green('npx storyboard canvas add sticky-note')}  Add a widget to a canvas`,
    '',
    `${i}  ${dim('Using an AI assistant? You can also ask it to')}`,
    `${i}  ${dim('"create a prototype", "create a canvas" or "create a component" for you!')}`,
    '',
    `${i}  ${dim('Docs:')} ${cyan('https://github.com/dfosco/storyboard/blob/main/README.md')}`,
  ]
}
