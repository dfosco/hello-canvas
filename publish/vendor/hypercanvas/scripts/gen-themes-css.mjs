#!/usr/bin/env node
/**
 * Pre-step for `tailwindcss` CLI: generate `themes.generated.css` next to
 * `tailwind.css` so the standalone CLI can resolve the `@import` during
 * `build:css` (publish flow). At dev time the Vite data plugin does the
 * same write; this script exists so the build doesn't depend on Vite.
 *
 * Themes config resolution order (first existing wins):
 *   1. <repoRoot>/storyboard.config.json  — the source repo's own config
 *   2. <packageDir>/storyboard.config.json — the package-level baseline
 *      that ships with @dfosco/storyboard
 *
 * Both paths are tried so the build never fails when only the package
 * baseline is present (e.g. a fresh checkout with a missing repo config).
 *
 * Layout (relative to this script):
 *   scripts/gen-themes-css.mjs       (here)
 *   src/core/styles/tailwind.css     (sibling target dir)
 *   ../../storyboard.config.json     (source repo root)
 *   ../storyboard.config.json        (package-level baseline)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  generateThemesCss,
  GENERATED_THEMES_CSS_FILENAME,
} from '../src/core/styles/generateThemesCss.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(here, '..')              // packages/storyboard
const repoRoot = path.resolve(packageDir, '..', '..')    // storyboard-core
const stylesDir = path.join(packageDir, 'src', 'core', 'styles')
const outPath = path.join(stylesDir, GENERATED_THEMES_CSS_FILENAME)

const candidates = [
  path.join(repoRoot, 'storyboard.config.json'),
  path.join(packageDir, 'storyboard.config.json'),
]

let themesCfg = null
let usedPath = null
for (const candidate of candidates) {
  if (!fs.existsSync(candidate)) continue
  try {
    const raw = JSON.parse(fs.readFileSync(candidate, 'utf-8'))
    themesCfg = raw?.theming || {}
    usedPath = candidate
    break
  } catch (err) {
    console.warn(`[gen-themes-css] failed to parse ${candidate}: ${err.message}`)
  }
}

if (!usedPath) {
  // Last resort — write an empty themes block. generateThemesCss handles
  // missing surfaces by emitting only the legacy attr selectors, which is
  // still a valid (if minimal) dark variant.
  console.warn('[gen-themes-css] no storyboard.config.json found; emitting legacy-only dark variant')
  themesCfg = {}
}

const css = generateThemesCss(themesCfg)
fs.mkdirSync(stylesDir, { recursive: true })
fs.writeFileSync(outPath, css)
const source = usedPath ? path.relative(repoRoot, usedPath) : '(none)'
console.log(`[gen-themes-css] wrote ${path.relative(repoRoot, outPath)} (source: ${source})`)
