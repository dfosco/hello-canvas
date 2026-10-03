import { describe, it, expect } from 'vitest'
import { detectFlavor, isTextFile, getLanguageId } from '../fileFlavor.js'

describe('detectFlavor', () => {
  // ── Markdown ──────────────────────────────────────────────────────────────

  describe('markdown flavor', () => {
    it('detects .md', () => {
      expect(detectFlavor('README.md')).toMatchObject({
        flavor: 'markdown', language: 'markdown', mime: 'text/markdown', isText: true, extension: 'md',
      })
    })

    it('detects .markdown', () => {
      expect(detectFlavor('guide.markdown')).toMatchObject({ flavor: 'markdown', extension: 'markdown' })
    })

    it('detects .md in a deep path', () => {
      expect(detectFlavor('docs/api/../guide.md')).toMatchObject({ flavor: 'markdown' })
    })
  })

  // ── MDX ───────────────────────────────────────────────────────────────────

  describe('mdx flavor', () => {
    it('detects .mdx', () => {
      expect(detectFlavor('Component.mdx')).toMatchObject({
        flavor: 'mdx', language: 'markdown', mime: 'text/mdx', isText: true, extension: 'mdx',
      })
    })
  })

  // ── Code flavors ──────────────────────────────────────────────────────────

  describe('code flavor — JavaScript family', () => {
    it('detects .js', () => {
      expect(detectFlavor('app.js')).toMatchObject({ flavor: 'code', language: 'javascript' })
    })

    it('detects .jsx', () => {
      expect(detectFlavor('Button.jsx')).toMatchObject({ flavor: 'code', language: 'javascript' })
    })

    it('detects .ts', () => {
      expect(detectFlavor('index.ts')).toMatchObject({ flavor: 'code', language: 'typescript' })
    })

    it('detects .tsx', () => {
      expect(detectFlavor('App.tsx')).toMatchObject({ flavor: 'code', language: 'typescript' })
    })

    it('detects .cjs', () => {
      expect(detectFlavor('config.cjs')).toMatchObject({ flavor: 'code', language: 'javascript' })
    })

    it('detects .mjs', () => {
      expect(detectFlavor('utils.mjs')).toMatchObject({ flavor: 'code', language: 'javascript' })
    })
  })

  describe('code flavor — styles', () => {
    it('detects .css', () => {
      expect(detectFlavor('styles.css')).toMatchObject({ flavor: 'code', language: 'css' })
    })

    it('detects .scss', () => {
      expect(detectFlavor('theme.scss')).toMatchObject({ flavor: 'code', language: 'css' })
    })
  })

  describe('code flavor — markup', () => {
    it('detects .html', () => {
      expect(detectFlavor('index.html')).toMatchObject({ flavor: 'code', language: 'html' })
    })

    it('detects .htm', () => {
      expect(detectFlavor('page.htm')).toMatchObject({ flavor: 'code', language: 'html' })
    })

    it('detects .svg', () => {
      expect(detectFlavor('icon.svg')).toMatchObject({ flavor: 'code', language: 'html' })
    })

    it('detects .xml', () => {
      expect(detectFlavor('feed.xml')).toMatchObject({ flavor: 'code', language: 'html' })
    })
  })

  describe('code flavor — data', () => {
    it('detects .json', () => {
      expect(detectFlavor('package.json')).toMatchObject({ flavor: 'code', language: 'json' })
    })

    it('detects .jsonc', () => {
      expect(detectFlavor('tsconfig.jsonc')).toMatchObject({ flavor: 'code', language: 'json' })
    })

    it('detects .jsonl', () => {
      expect(detectFlavor('data.jsonl')).toMatchObject({ flavor: 'code', language: 'json' })
    })

    it('detects .yaml', () => {
      expect(detectFlavor('config.yaml')).toMatchObject({ flavor: 'code', language: 'yaml' })
    })

    it('detects .yml', () => {
      expect(detectFlavor('.github/workflows/ci.yml')).toMatchObject({ flavor: 'code', language: 'yaml' })
    })

    it('detects .toml', () => {
      expect(detectFlavor('Cargo.toml')).toMatchObject({ flavor: 'code', language: null })
    })
  })

  describe('code flavor — languages', () => {
    it('detects .py', () => {
      expect(detectFlavor('main.py')).toMatchObject({ flavor: 'code', language: 'python' })
    })

    it('detects .rb', () => {
      expect(detectFlavor('app.rb')).toMatchObject({ flavor: 'code', language: 'ruby' })
    })

    it('detects .go', () => {
      expect(detectFlavor('server.go')).toMatchObject({ flavor: 'code', language: 'go' })
    })

    it('detects .rs', () => {
      expect(detectFlavor('main.rs')).toMatchObject({ flavor: 'code', language: 'rust' })
    })

    it('detects .java', () => {
      expect(detectFlavor('Main.java')).toMatchObject({ flavor: 'code', language: 'java' })
    })

    it('detects .c', () => {
      expect(detectFlavor('hello.c')).toMatchObject({ flavor: 'code', language: 'cpp' })
    })

    it('detects .cpp', () => {
      expect(detectFlavor('engine.cpp')).toMatchObject({ flavor: 'code', language: 'cpp' })
    })

    it('detects .sh', () => {
      expect(detectFlavor('deploy.sh')).toMatchObject({ flavor: 'code', language: 'shell' })
    })

    it('detects .zsh', () => {
      expect(detectFlavor('config.zsh')).toMatchObject({ flavor: 'code', language: 'shell' })
    })
  })

  // ── Well-known extensionless files ────────────────────────────────────────

  describe('well-known extensionless files', () => {
    it('detects Dockerfile', () => {
      expect(detectFlavor('Dockerfile')).toMatchObject({
        flavor: 'code', isText: true, extension: '',
      })
    })

    it('detects Makefile', () => {
      expect(detectFlavor('Makefile')).toMatchObject({ flavor: 'code', isText: true })
    })

    it('detects LICENSE', () => {
      expect(detectFlavor('LICENSE')).toMatchObject({ flavor: 'code', isText: true })
    })

    it('detects README (no extension)', () => {
      expect(detectFlavor('README')).toMatchObject({ flavor: 'code', isText: true })
    })

    it('detects .gitignore', () => {
      expect(detectFlavor('.gitignore')).toMatchObject({ flavor: 'code', isText: true })
    })

    it('detects .env', () => {
      expect(detectFlavor('.env')).toMatchObject({ flavor: 'code', isText: true })
    })

    it('detects .npmrc', () => {
      expect(detectFlavor('.npmrc')).toMatchObject({ flavor: 'code', isText: true })
    })

    it('is case-insensitive for well-known names', () => {
      expect(detectFlavor('dockerfile')).toMatchObject({ flavor: 'code', isText: true })
      expect(detectFlavor('MAKEFILE')).toMatchObject({ flavor: 'code', isText: true })
    })
  })

  // ── Unsupported / unknown ─────────────────────────────────────────────────

  describe('unsupported files', () => {
    it('returns unsupported for .png', () => {
      expect(detectFlavor('photo.png')).toMatchObject({ flavor: 'unsupported', isText: false })
    })

    it('returns unsupported for .pdf', () => {
      expect(detectFlavor('doc.pdf')).toMatchObject({ flavor: 'unsupported', isText: false })
    })

    it('returns unsupported for unknown extension', () => {
      expect(detectFlavor('file.xyz123')).toMatchObject({ flavor: 'unsupported', isText: false })
    })

    it('returns unsupported for a truly unknown extensionless file', () => {
      expect(detectFlavor('somebinaryblob')).toMatchObject({ flavor: 'unsupported', isText: false })
    })
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns unsupported for empty string', () => {
      expect(detectFlavor('')).toMatchObject({ flavor: 'unsupported', isText: false })
    })

    it('returns unsupported for undefined', () => {
      expect(detectFlavor(undefined)).toMatchObject({ flavor: 'unsupported', isText: false })
    })

    it('returns unsupported for null', () => {
      expect(detectFlavor(null)).toMatchObject({ flavor: 'unsupported', isText: false })
    })

    it('strips query strings before detection', () => {
      expect(detectFlavor('notes.md?v=1')).toMatchObject({ flavor: 'markdown' })
    })

    it('strips hash fragments before detection', () => {
      expect(detectFlavor('docs.md#section')).toMatchObject({ flavor: 'markdown' })
    })

    it('handles paths with .. segments', () => {
      expect(detectFlavor('a/b/../c/file.ts')).toMatchObject({ flavor: 'code', language: 'typescript' })
    })

    it('handles a path with no filename after last slash', () => {
      expect(detectFlavor('some/dir/')).toMatchObject({ flavor: 'unsupported' })
    })
  })
})

// ── isTextFile ───────────────────────────────────────────────────────────────

describe('isTextFile', () => {
  it('returns true for .md', () => {
    expect(isTextFile('file.md')).toBe(true)
  })

  it('returns true for Dockerfile', () => {
    expect(isTextFile('Dockerfile')).toBe(true)
  })

  it('returns false for .png', () => {
    expect(isTextFile('image.png')).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isTextFile(undefined)).toBe(false)
  })
})

// ── getLanguageId ─────────────────────────────────────────────────────────────

describe('getLanguageId', () => {
  it('returns javascript for .js', () => {
    expect(getLanguageId('app.js')).toBe('javascript')
  })

  it('returns typescript for .tsx', () => {
    expect(getLanguageId('App.tsx')).toBe('typescript')
  })

  it('returns markdown for .mdx', () => {
    expect(getLanguageId('page.mdx')).toBe('markdown')
  })

  it('returns null for .toml (plain text, no CM language)', () => {
    expect(getLanguageId('config.toml')).toBe(null)
  })

  it('returns null for unsupported extension', () => {
    expect(getLanguageId('file.bin')).toBe(null)
  })
})
