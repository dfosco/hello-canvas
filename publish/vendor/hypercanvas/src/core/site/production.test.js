import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { confirmProductionSiteUrl, discoverProductionSiteUrl } from './production.js'

describe('Site production resolution', () => {
  it('returns provider findings without publishing side effects', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-provider-'))
    await fs.writeFile(path.join(root, 'vercel.json'), '{ "domain": "https://docs.example" }')
    expect(discoverProductionSiteUrl(root)).toEqual([expect.objectContaining({ provider: 'Vercel', baseUrl: 'https://docs.example/' })])
  })

  it('requires confirmation before accepting a production URL', () => {
    expect(() => confirmProductionSiteUrl({ candidate: 'https://example.com' })).toThrow(/confirmation/)
    expect(confirmProductionSiteUrl({ candidate: 'https://example.com', confirmed: true })).toBe('https://example.com/')
  })
})
