import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { __test as generator } from './publishing/generator.js'

const roots = []

function temp(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `storyboard-${name}-`))
  roots.push(root)
  return root
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('Notebook path aliases in published sites', () => {
  it('does not treat the @/ local alias as an npm package', () => {
    expect(generator.packageNameFromSpecifier('@/components/GlobalNavigation/GlobalNavigation.jsx')).toBeNull()
    expect(generator.packageNameFromSpecifier('@primer/react')).toBe('@primer/react')
  })

  it('maps @/ imports to the published Notebook root', () => {
    const files = generator.generatedFiles({
      root: process.cwd(),
      manifest: { id: 'alias-test', title: 'Alias test' },
    }, [], new Map(), [])

    expect(files['vite.config.js']).toContain("'@': fileURLToPath(new URL('./notebook-content/', import.meta.url))")
  })

  it('uses a Notebook package lock version for imported dependencies outside Hypercanvas', () => {
    const root = temp('notebook-locked-dependency')
    fs.mkdirSync(path.join(root, 'templates'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { recharts: '^3.10.0' } }))
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: { '': { dependencies: { recharts: '^3.10.0' } }, 'node_modules/recharts': { version: '3.10.1' } },
    }))
    fs.writeFileSync(path.join(root, 'templates/chart.jsx'), "import { PieChart } from 'recharts'\nexport default PieChart\n")

    expect(generator.prototypeDependencies({ root }, ['templates/chart.jsx'])).toEqual({ recharts: '3.10.1' })
  })
})
