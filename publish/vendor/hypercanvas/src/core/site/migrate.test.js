import { describe, expect, it } from 'vitest'
import { migrateWorktopFrameProps, migrateWorktopProject } from './migrate.js'

describe('Worktop Site migration', () => {
  it('migrates portable project metadata but not local bindings', () => {
    const result = migrateWorktopProject({ id: 'billing', title: 'Billing', productionBaseUrl: 'https://billing.example' })
    expect(result.site).toMatchObject({ id: 'billing', title: 'Billing' })
    expect(result.binding).toBeNull()
    expect(result.warnings[0]).toMatch(/not migrated/)
  })

  it('renames project frame identity without carrying localhost URLs', () => {
    expect(migrateWorktopFrameProps({ projectId: 'billing', route: 'checkout', developmentBaseUrl: 'http://localhost:1234/' })).toEqual({ route: 'checkout', siteId: 'billing' })
  })
})
