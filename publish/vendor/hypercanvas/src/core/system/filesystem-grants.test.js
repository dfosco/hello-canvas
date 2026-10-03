import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemGrants } from './filesystem-grants.js'

const directories = []

function directory(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hypercanvas-grant-${name}-`))
  directories.push(root)
  return root
}

afterEach(() => {
  for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Core filesystem root grants', () => {
  it('requires a purpose-matched picker grant for browser roots and consumes it once', () => {
    const root = directory('site')
    const origin = 'http://127.0.0.1:4317'
    const grants = createFilesystemGrants()
    const browser = { headers: { origin, 'sec-fetch-site': 'same-origin' } }
    grants.registerBrowserOrigin(origin)
    grants.registerBrowserOrigin('http://127.0.0.1:4318')

    grants.grantDirectory(root, { purpose: 'site', request: browser })

    expect(grants.hasDirectoryGrant(browser, root, { purpose: 'notebook' })).toBe(false)
    const foreignOrigin = { headers: { origin: 'http://127.0.0.1:4318', 'sec-fetch-site': 'same-site' } }
    expect(() => grants.resolveDirectory(foreignOrigin, root, { purpose: 'site' })).toThrow(/another browser origin/)
    expect(grants.resolveDirectory(browser, root, { purpose: 'site' })).toBe(fs.realpathSync.native(root))
    expect(() => grants.resolveDirectory(browser, root, { purpose: 'site' })).toThrow(/Choose this directory through Core/)
  })

  it('expires grants and refuses the filesystem root', () => {
    const root = directory('expired')
    let now = 1000
    const grants = createFilesystemGrants({ ttlMs: 50, now: () => now })
    const browser = { headers: { origin: 'http://127.0.0.1:4317' } }
    grants.registerBrowserOrigin(browser.headers.origin)
    grants.grantDirectory(root, { purpose: 'notebook', request: browser })
    now += 51

    expect(() => grants.resolveDirectory(browser, root, { purpose: 'notebook' })).toThrow(/Choose this directory through Core/)
    expect(() => grants.grantDirectory(path.parse(root).root)).toThrow(/filesystem root cannot be granted/)
  })

  it('resolves symlink selections canonically and preserves explicit local CLI paths', () => {
    const root = directory('canonical')
    const alias = path.join(path.dirname(root), `hypercanvas-grant-alias-${process.pid}`)
    directories.push(alias)
    fs.symlinkSync(root, alias, 'dir')
    const grants = createFilesystemGrants()
    const browser = { headers: { origin: 'http://127.0.0.1:4317', 'sec-fetch-site': 'same-origin' } }
    grants.registerBrowserOrigin(browser.headers.origin)
    grants.grantDirectory(alias, { purpose: 'notebook', request: browser })

    expect(grants.resolveDirectory(browser, root, { purpose: 'notebook' })).toBe(fs.realpathSync.native(root))
    expect(grants.resolveDirectory({ headers: { 'user-agent': 'node' } }, root, { purpose: 'site' })).toBe(fs.realpathSync.native(root))
  })

  it('treats missing request metadata as untrusted browser input', () => {
    const grants = createFilesystemGrants()
    expect(() => grants.resolveDirectory({}, '/tmp/untrusted-root', { purpose: 'site' }))
      .toThrow(/registered loopback browser origin/)
  })
})
