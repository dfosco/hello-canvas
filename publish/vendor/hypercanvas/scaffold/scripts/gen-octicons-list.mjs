#!/usr/bin/env node
// Regenerate .agents/data/primer-octicons.json from the installed @primer/octicons-react package.
// Run after bumping @primer/octicons-react.
import fs from 'node:fs'
import * as icons from '@primer/octicons-react'

const pkg = JSON.parse(fs.readFileSync('node_modules/@primer/octicons-react/package.json', 'utf8'))
const names = Object.keys(icons).filter((k) => k.endsWith('Icon')).sort()

const out = {
  package: '@primer/octicons-react',
  version: pkg.version,
  count: names.length,
  generatedAt: new Date().toISOString(),
  note:
    'Authoritative list of valid icon exports from @primer/octicons-react. ONLY import names present in this list. If you need an icon that is not here, pick the closest available one — do NOT invent names (e.g. ScissorsIcon does not exist). Regenerate via: node scripts/gen-octicons-list.mjs',
  icons: names,
}

fs.mkdirSync('.agents/data', { recursive: true })
fs.writeFileSync('.agents/data/primer-octicons.json', JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${names.length} icons, v${pkg.version}`)
