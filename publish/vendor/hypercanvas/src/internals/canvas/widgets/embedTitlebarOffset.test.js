/**
 * Regression test: the embed-style canvas widgets (PrototypeEmbed,
 * StoryWidget, StorySetWidget) must size their iframe area via flex
 * layout — NOT via `calc(100% - <N>px)` magic numbers tied to the
 * titlebar's actual rendered height.
 *
 * Previously each file hand-subtracted a 37px (later 33px) titlebar
 * offset from the iframe container's height. A titlebar tweak (commit
 * f06dddeb7, shipped in 0.11.0) shrank the rendered titlebar by 4px
 * but four of six call sites kept the old offset → embedded iframes
 * rendered 4px shorter than the available space, clipping the bottom
 * of the embedded page. The fix replaced every offset with `flex: 1`
 * (CSS) / `flex-1 min-h-0` (Tailwind) so the iframe area grows to fill
 * whatever vertical space the titlebar doesn't claim.
 *
 * This test asserts no file in the set re-introduces a `calc(100% - Npx)`
 * sizing pattern for the iframe area, and that each one keeps the flex
 * layout in place. If you genuinely need a magic offset for a special
 * case, document why here and exclude that file.
 */

import { describe, expect, test } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const files = [
  'PrototypeEmbed.jsx',
  'PrototypeEmbed.module.css',
  'StoryWidget.jsx',
  'StoryWidget.module.css',
  'StorySetWidget.jsx',
].map(name => [path.join(__dirname, name), name])

describe('embed widget iframe-area sizing', () => {
  for (const [file, name] of files) {
    test(`${name} uses flex layout (no calc(100% - Npx) magic numbers)`, () => {
      const source = readFileSync(file, 'utf8')

      // Catch both `calc(100% - 33px)` (CSS) and `calc(100%-33px)`
      // (Tailwind arbitrary value form). If this assertion fires you've
      // likely re-introduced a hand-tuned titlebar offset.
      const magicPattern = /calc\(100%\s*-\s*\d+px\)/g
      const magic = source.match(magicPattern) || []
      expect(magic, `${name} should not contain calc(100% - Npx)`).toEqual([])
    })
  }
})

