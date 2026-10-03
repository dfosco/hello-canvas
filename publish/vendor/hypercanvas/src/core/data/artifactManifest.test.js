import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildArtifactManifest, resolveManifestEnv, sanitizeBranchName } from './artifactManifest.js'

const env = {
  branch: 'feature/foo',
  deployBranch: 'feature-foo',
  folder: 'branch--feature-foo',
  sha: 'abc1234',
  generatedAt: '2026-06-04T09:18:42Z',
  basePath: '/branch--feature-foo/',
}

function repoGit(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

describe('buildArtifactManifest', () => {
  it('matches the manifest schema for typical discovery data', () => {
    const discovery = {
      prototypes: {
        Dashboard: {
          meta: { title: 'Repository Dashboard', description: '...' },
          folder: 'main',
          route: '/Repositories',
          lastModified: '2026-06-03T12:00:00Z',
        },
      },
      canvases: {
        'widget/design-system': {
          title: 'Design System',
          _folder: 'widget',
          _route: '/canvas/widget/design-system',
          lastModified: '2026-06-02T18:30:00Z',
        },
      },
      folders: {
        main: { meta: { title: 'Main Prototypes' } },
      },
    }

    expect(buildArtifactManifest({ discovery, env })).toEqual({
      schemaVersion: 1,
      branch: 'feature/foo',
      deployBranch: 'feature-foo',
      folder: 'branch--feature-foo',
      sha: 'abc1234',
      generatedAt: '2026-06-04T09:18:42Z',
      basePath: '/branch--feature-foo/',
      prototypes: [
        {
          id: 'Dashboard',
          dirName: 'Dashboard',
          title: 'Repository Dashboard',
          description: '...',
          folder: 'main',
          isExternal: false,
          externalUrl: null,
          route: '/Repositories',
          isPrivate: false,
          crossBranch: true,
          lastModified: '2026-06-03T12:00:00Z',
        },
      ],
      canvases: [
        {
          id: 'widget/design-system',
          name: 'Design System',
          folder: 'widget',
          route: '/canvas/widget/design-system',
          isPrivate: false,
          crossBranch: true,
          group: null,
          pages: null,
          lastModified: '2026-06-02T18:30:00Z',
        },
      ],
      folders: [
        { name: 'main', title: 'Main Prototypes', isPrivate: false },
      ],
    })
  })

  it('publishes every registered artifact regardless of legacy drafts markers', () => {
    const manifest = buildArtifactManifest({
      env,
      discovery: {
        prototypes: {
          SecretPrototype: { meta: { title: 'Secret' }, _isPrivate: true },
          PublicPrototype: { meta: { title: 'Public' } },
        },
        canvases: {
          secret: { title: 'Secret Canvas', _isPrivate: true },
          public: { title: 'Public Canvas' },
        },
        folders: {
          secret: { meta: { title: 'Secret Folder' }, _isPrivate: true },
          public: { meta: { title: 'Public Folder' } },
        },
      },
    })

    expect(manifest.prototypes.map((item) => item.id)).toEqual(['PublicPrototype', 'SecretPrototype'])
    expect(manifest.canvases.map((item) => item.id)).toEqual(['public', 'secret'])
    expect(manifest.folders.map((item) => item.name)).toEqual(['public', 'secret'])
    expect(manifest.prototypes.every(item => !item.isPrivate)).toBe(true)
    expect(manifest.canvases.every(item => !item.isPrivate)).toBe(true)
    expect(manifest.folders.every(item => !item.isPrivate)).toBe(true)
  })

  it('omits prototypes and canvases with meta.crossBranch set to false', () => {
    const manifest = buildArtifactManifest({
      env,
      discovery: {
        prototypes: {
          HiddenPrototype: { meta: { title: 'Hidden', crossBranch: false } },
          VisiblePrototype: { meta: { title: 'Visible' } },
        },
        canvases: {
          hidden: { title: 'Hidden Canvas', _canvasMeta: { crossBranch: false } },
          visible: { title: 'Visible Canvas' },
        },
      },
    })

    expect(manifest.prototypes.map((item) => item.id)).toEqual(['VisiblePrototype'])
    expect(manifest.canvases.map((item) => item.id)).toEqual(['visible'])
  })

  it('sets external prototype route and URL fields', () => {
    const manifest = buildArtifactManifest({
      env,
      discovery: {
        prototypes: {
          ExternalApp: {
            meta: { title: 'External App', description: 'Hosted elsewhere' },
            url: 'https://example.com/prototype',
          },
        },
      },
    })

    expect(manifest.prototypes).toEqual([
      {
        id: 'ExternalApp',
        dirName: 'ExternalApp',
        title: 'External App',
        description: 'Hosted elsewhere',
        folder: null,
        isExternal: true,
        externalUrl: 'https://example.com/prototype',
        route: null,
        isPrivate: false,
        crossBranch: true,
        lastModified: null,
      },
    ])
  })
})

describe('sanitizeBranchName', () => {
  it('mirrors the preview deploy folder sanitizer', () => {
    expect(sanitizeBranchName('feature/foo')).toBe('feature-foo')
    expect(sanitizeBranchName('release-3.2')).toBe('release-3.2')
    expect(sanitizeBranchName('--feature///foo--')).toBe('feature-foo')
  })
})

describe('resolveManifestEnv', () => {
  it('honors GitHub and Vite environment values', () => {
    const resolved = resolveManifestEnv({
      env: {
        GITHUB_REF_NAME: 'feature/foo',
        GITHUB_SHA: 'abc1234',
        VITE_BASE_PATH: '/branch--feature-foo/',
        generatedAt: '2026-06-04T09:18:42Z',
      },
      cwd: process.cwd(),
    })

    expect(resolved).toEqual(env)
  })

  it('falls back to git branch and sha when env values are absent', () => {
    const branch = repoGit(['branch', '--show-current']) || 'main'
    const sha = repoGit(['rev-parse', 'HEAD'])
    const resolved = resolveManifestEnv({
      env: { generatedAt: '2026-06-04T09:18:42Z' },
      cwd: process.cwd(),
    })

    expect(resolved).toEqual({
      branch,
      deployBranch: sanitizeBranchName(branch),
      folder: branch === 'main' ? '' : `branch--${sanitizeBranchName(branch)}`,
      sha,
      generatedAt: '2026-06-04T09:18:42Z',
      basePath: '/',
    })
  })

  it('uses an empty folder for main and branch--deployBranch otherwise', () => {
    expect(resolveManifestEnv({ env: { branch: 'main', generatedAt: 'now' } }).folder).toBe('')
    expect(resolveManifestEnv({ env: { branch: 'feature/foo', generatedAt: 'now' } }).folder).toBe('branch--feature-foo')
  })
})
