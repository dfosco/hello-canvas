/**
 * InspectorPanel — Inspector tab for the side panel.
 * Select DOM elements and view their React component information.
 * Uses mouseMode for element selection and fiberWalker for component introspection.
 */

import './InspectorPanel.css'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import octicons from '@primer/octicons'
import { inspectElement, inspectElementChain } from '../inspector/fiberWalker.js'
import { createMouseMode } from '../inspector/mouseMode.js'
import { getColors, createInspectorHighlighter } from '../inspector/highlighter.js'

// ── Inline icon helpers ─────────────────────────────────────────

function OcticonSvg({ name, size = 16, className, style }) {
  const icon = octicons[name]
  if (!icon) return null
  const svg = icon.toSVG({ width: size, height: size }).replace('<svg ', '<svg fill="currentColor" ')
  return <span className={className} style={{ display: 'inline-flex', alignItems: 'center', ...style }} dangerouslySetInnerHTML={{ __html: svg }} />
}

function IconoirSquareDashed({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2H5a3 3 0 00-3 3v2M17 2h2a3 3 0 013 3v2M17 22h2a3 3 0 003-3v-2M7 22H5a3 3 0 01-3-3v-2" />
    </svg>
  )
}

// ── Constants ───────────────────────────────────────────────────

const _isLocalDev = typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true && !new URLSearchParams(window.location.search).has('prodMode')
const _basePath = (typeof window !== 'undefined' && window.__STORYBOARD_BASE_PATH__) || '/'

// ── URL state helpers ───────────────────────────────────────────

function generateSelector(el) {
  if (!(el instanceof Element)) return null
  if (el.id) return `#${CSS.escape(el.id)}`

  const testId = el.getAttribute('data-testid')
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`

  const parts = []
  let cur = el
  while (cur && cur !== document.body && cur !== document.documentElement) {
    let seg = cur.tagName.toLowerCase()
    if (cur.id) {
      parts.unshift(`#${CSS.escape(cur.id)}`)
      break
    }
    const parent = cur.parentElement
    if (parent) {
      const siblings = Array.from(parent.children)
      const idx = siblings.indexOf(cur) + 1
      seg += `:nth-child(${idx})`
    }
    parts.unshift(seg)
    cur = parent
  }
  return parts.length ? parts.join(' > ') : null
}

function getInspectParam() {
  try {
    return new URL(window.location.href).searchParams.get('inspect')
  } catch { return null }
}

function setInspectParam(selector) {
  try {
    const url = new URL(window.location.href)
    if (selector) {
      url.searchParams.set('inspect', selector)
    } else {
      url.searchParams.delete('inspect')
    }
    history.replaceState(history.state, '', url.toString())
  } catch { /* ignore */ }
}

// ── Source file helpers ─────────────────────────────────────────

let staticInspectorData = null

async function loadStaticData() {
  if (staticInspectorData) return staticInspectorData
  try {
    const basePath = window.__STORYBOARD_BASE_PATH__ || '/'
    const res = await fetch(`${basePath}_storyboard/inspector.json`)
    if (res.ok) {
      staticInspectorData = await res.json()
      return staticInspectorData
    }
  } catch { /* ignore */ }
  return null
}

async function fetchSourceContent(filePath) {
  if (_isLocalDev) {
    try {
      const res = await fetch(`${_basePath.replace(/\/$/, '')}/_storyboard/docs/source?path=${encodeURIComponent(filePath)}`)
      if (res.ok) {
        const json = await res.json()
        return json?.content || ''
      }
    } catch { /* ignore */ }
  }
  const data = await loadStaticData()
  return data?.sources?.[filePath] || ''
}

function getLang(filePath) {
  if (filePath.endsWith('.tsx')) return 'tsx'
  if (filePath.endsWith('.jsx')) return 'jsx'
  if (filePath.endsWith('.ts')) return 'typescript'
  return 'javascript'
}

function findComponentLine(code, info) {
  if (!code || !info?.name) return -1

  const lines = code.split('\n')
  const name = info.name
  const props = info.props || {}

  const propSignatures = []
  for (const [key, val] of Object.entries(props)) {
    if (key === 'children') continue
    if (typeof val === 'string') {
      propSignatures.push(`"${val}"`, `'${val}'`, `\`${val}\``, `="${val}"`, `='${val}'`)
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      propSignatures.push(`{${val}}`, `=${val}`)
    }
  }

  const tagPattern = new RegExp(`<${name}[\\s/>]`)
  const candidates = []
  for (let i = 0; i < lines.length; i++) {
    if (tagPattern.test(lines[i])) {
      candidates.push(i)
    }
  }

  if (candidates.length === 0) return -1
  if (candidates.length === 1) return candidates[0] + 1

  let bestLine = candidates[0]
  let bestScore = -1

  for (const lineIdx of candidates) {
    const windowSlice = lines.slice(lineIdx, lineIdx + 6).join(' ')
    let score = 0
    for (const sig of propSignatures) {
      if (windowSlice.includes(sig)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestLine = lineIdx
    }
  }

  return bestLine + 1
}

function resolveSourceFile(info, knownFiles) {
  // Prefer the clicked element's own debug source — that's the exact JSX line
  // in the parent file, not the wrapping component definition.
  const src = info?.hostSource?.fileName ? info.hostSource : info?.source
  if (src?.fileName) {
    const cleanName = src.fileName.split('?')[0]
    const srcIndex = cleanName.indexOf('/src/')
    if (srcIndex !== -1) return cleanName.slice(srcIndex + 1)
    if (cleanName.startsWith('src/')) return cleanName
  }

  const pageFile = resolvePageFile(knownFiles)
  if (pageFile) return pageFile

  const name = info?.name
  if (name && name !== 'Anonymous' && name !== 'Unknown') {
    const match = knownFiles.find(f => {
      const base = f.split('/').pop()?.replace(/\.(jsx|tsx|js|ts)$/, '')
      return base === name
    })
    if (match) return match
  }

  return null
}

function resolvePageFile(knownFiles) {
  if (knownFiles.length === 0) return null

  let pathname = window.location.pathname
  if (pathname.startsWith('/')) pathname = pathname.slice(1)
  pathname = pathname.replace(/\/$/, '')

  const normalizedFiles = knownFiles.map(f => ({
    original: f,
    normalized: f
      .replace(/^src\/prototypes\//, '')
      .replace(/[^/]*\.folder\//g, '')
      .replace(/\.(jsx|tsx|js|ts)$/, ''),
  }))

  const segments = pathname.split('/').filter(Boolean)
  for (let start = 0; start < segments.length; start++) {
    const routeEnd = segments.slice(start).join('/')
    if (!routeEnd) continue

    for (const { original, normalized } of normalizedFiles) {
      const withoutIndex = normalized.replace(/\/index$/, '')
      if (withoutIndex === routeEnd || normalized === routeEnd) return original
    }
  }

  if (!pathname || segments.length === 0) {
    const idx = knownFiles.find(f => /^src\/prototypes\/index\.(jsx|tsx|js|ts)$/.test(f))
    if (idx) return idx
  }

  return null
}

// ── Component ───────────────────────────────────────────────────

export default function InspectorPanel() {
  const [componentInfo, setComponentInfo] = useState(null)
  const [componentChain, setComponentChain] = useState([])
  const [inspecting, setInspecting] = useState(false)
  const [sourceCode, setSourceCode] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourcePath, setSourcePath] = useState('')
  const [matchedLine, setMatchedLine] = useState(-1)
  const [highlightedHtml, setHighlightedHtml] = useState('')
  const [codeTheme, setCodeTheme] = useState(getColors)
  const [repoInfo, setRepoInfo] = useState(null)

  const sourceContainerRef = useRef(null)
  const mouseModeRef = useRef(null)
  const knownFilesRef = useRef([])
  const highlighterRef = useRef(null)

  const hasSelection = componentInfo !== null

  const gitBranch = useMemo(() => {
    const m = window.location.pathname.match(/\/branch--([^/]+)/)
    if (m) return m[1].replace(/-/g, '/')
    return 'main'
  }, [])

  const githubUrl = useMemo(() => {
    if (!repoInfo || !sourcePath) return null
    const base = `https://github.com/${repoInfo.owner}/${repoInfo.name}/blob/${gitBranch}/${sourcePath}`
    const line = matchedLine > 0 ? matchedLine : componentInfo?.source?.lineNumber
    return line ? `${base}#L${line}` : base
  }, [repoInfo, sourcePath, gitBranch, matchedLine, componentInfo])

  async function getHighlighter() {
    if (highlighterRef.current) return highlighterRef.current
    highlighterRef.current = await createInspectorHighlighter()
    return highlighterRef.current
  }

  const rehighlight = useCallback(async () => {
    setCodeTheme(getColors())
  }, [])

  // Handle element selection
  const _handleSelect = useCallback((el) => {
    const info = inspectElement(el)
    const chain = inspectElementChain(el)
    setComponentInfo(info)
    setComponentChain(chain)
    setInspecting(false)
    mouseModeRef.current?.showHighlight(el)
    setInspectParam(generateSelector(el))
  }, [])

  const _handleDeactivate = useCallback(() => {
    setInspecting(false)
  }, [])
  void _handleSelect
  void _handleDeactivate

  const startInspecting = useCallback(() => {
    mouseModeRef.current?.hideHighlight()
    mouseModeRef.current?.activate()
    setInspecting(true)
    setInspectParam(null)
  }, [])

  const stopInspecting = useCallback(() => {
    mouseModeRef.current?.deactivate()
    setInspecting(false)
  }, [])

  // Mount: create mouse mode, fetch files, restore selection
  useEffect(() => {
    const mouseMode = createMouseMode({
      onSelect: (el) => {
        const info = inspectElement(el)
        const chain = inspectElementChain(el)
        setComponentInfo(info)
        setComponentChain(chain)
        setInspecting(false)
        mouseMode.showHighlight(el)
        setInspectParam(generateSelector(el))
      },
      onDeactivate: () => setInspecting(false),
    })
    mouseModeRef.current = mouseMode

    document.addEventListener('storyboard:theme:changed', rehighlight)

    ;(async () => {
      let filesLoaded = false
      if (_isLocalDev) {
        try {
          const [filesRes, repoRes] = await Promise.all([
            fetch(`${_basePath.replace(/\/$/, '')}/_storyboard/docs/files`),
            fetch(`${_basePath.replace(/\/$/, '')}/_storyboard/docs/repo`),
          ])
          if (filesRes.ok) {
            const data = await filesRes.json()
            knownFilesRef.current = data.files || []
            filesLoaded = true
          }
          if (repoRes.ok) {
            setRepoInfo(await repoRes.json())
          }
        } catch { /* ignore */ }
      }

      if (!filesLoaded) {
        const data = await loadStaticData()
        if (data) {
          knownFilesRef.current = data.files || []
          setRepoInfo(data.repo || null)
        }
      }

      // Restore inspector selection from URL param
      const savedSelector = getInspectParam()
      let restored = false
      if (savedSelector) {
        for (let attempt = 0; attempt < 5 && !restored; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 300))
          try {
            const el = document.querySelector(savedSelector)
            if (el) {
              const info = inspectElement(el)
              const chain = inspectElementChain(el)
              setComponentInfo(info)
              setComponentChain(chain)
              try { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }) } catch { /* ignore */ }
              // Wait for smooth scroll to settle before pinning highlight to final rect
              await new Promise(r => setTimeout(r, 350))
              mouseMode.showHighlight(el)
              restored = true
            }
          } catch {
            break
          }
        }
        if (!restored) setInspectParam(null)
      }

      if (!restored) {
        mouseMode.hideHighlight()
        mouseMode.activate()
        setInspecting(true)
        setInspectParam(null)
      }
    })()

    return () => {
      mouseMode.deactivate()
      mouseMode.hideHighlight()
      setInspectParam(null)
      document.removeEventListener('storyboard:theme:changed', rehighlight)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load source when componentInfo changes
  useEffect(() => {
    if (!componentInfo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSourceCode('')
      setSourcePath('')
      setHighlightedHtml('')
      return
    }

    const path = resolveSourceFile(componentInfo, knownFilesRef.current)
    if (!path) {
      setSourceCode('')
      setSourcePath('')
      setHighlightedHtml('')
      return
    }

    let cancelled = false
    setSourceLoading(true)
    setSourcePath(path)
    setHighlightedHtml('')

    fetchSourceContent(path)
      .then(async (content) => {
        if (cancelled) return
        setSourceCode(content)
        // Prefer the exact line from the clicked fiber's _debugSource.
        // Fall back to heuristic matching only if unavailable.
        let line = -1
        const hostLine = componentInfo.hostSource?.lineNumber
        const hostFile = componentInfo.hostSource?.fileName?.split('?')[0]
        if (hostLine && hostFile && hostFile.endsWith(path.split('/').pop())) {
          line = hostLine
        }
        if (line < 0) {
          line = findComponentLine(content, componentInfo)
        }
        if (line < 0 && componentChain.length > 0) {
          for (const ancestor of componentChain) {
            line = findComponentLine(content, { name: ancestor.name, props: {} })
            if (line > 0) break
          }
        }
        setMatchedLine(line)

        if (content) {
          try {
            const hl = await getHighlighter()
            if (cancelled) return
            const html = hl.codeToHtml(content, {
              lang: getLang(path),
              theme: 'github-dark',
              lineNumbers: false,
              decorations: line > 0
                ? [{ start: { line: line - 1, character: 0 }, end: { line: line - 1, character: Infinity }, properties: { class: 'highlighted-line' } }]
                : [],
            })
            setHighlightedHtml(html)
          } catch {
            setHighlightedHtml('')
          }
        }
        setSourceLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setSourceCode('')
          setHighlightedHtml('')
          setMatchedLine(-1)
          setSourceLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [componentInfo, componentChain])

  // Scroll to highlighted line
  useEffect(() => {
    if (sourceContainerRef.current && highlightedHtml) {
      requestAnimationFrame(() => {
        const container = sourceContainerRef.current
        if (!container) return
        const el = container.querySelector('.highlighted-line')
        if (el) {
          // offsetTop is unreliable here — none of the wrappers are positioned,
          // so offsetParent resolves to <body>. Use bounding rects instead.
          const elRect = el.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          const targetTop = container.scrollTop + (elRect.top - containerRect.top) - 24
          container.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' })
        } else {
          container.scrollTop = 0
        }
      })
    }
  }, [highlightedHtml])

  // Re-highlight when theme changes
  useEffect(() => {
    if (!sourceCode || !sourcePath) return
    ;(async () => {
      try {
        const hl = await getHighlighter()
        const html = hl.codeToHtml(sourceCode, {
          lang: getLang(sourcePath),
          theme: 'github-dark',
          lineNumbers: false,
          decorations: matchedLine > 0
            ? [{ start: { line: matchedLine - 1, character: 0 }, end: { line: matchedLine - 1, character: Infinity }, properties: { class: 'highlighted-line' } }]
            : [],
        })
        setHighlightedHtml(html)
      } catch { /* ignore */ }
    })()
  }, [codeTheme]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentCodeTheme = codeTheme

  return (
    <div className="flex flex-col h-full" data-inspector-panel="">
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
        {/* Empty state */}
        {!hasSelection && !inspecting && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 py-12 text-center">
            <span style={{ color: 'var(--color-foreground-muted)', opacity: 0.4 }}>
              <IconoirSquareDashed size={48} />
            </span>
            <p className="text-sm font-medium m-0" style={{ color: 'var(--color-foreground)' }}>
              Select an element to start
            </p>
            <p className="text-xs m-0" style={{ color: 'var(--color-foreground-muted)' }}>
              Click the inspect button to enter selection mode
            </p>
            <button
              className="mt-2 px-4 py-1.5 text-xs font-medium rounded-md border-none cursor-pointer transition-colors"
              style={{ background: 'var(--color-foreground-accent, #7655a4)', color: '#fff' }}
              onClick={startInspecting}
            >
              Start inspecting
            </button>
          </div>
        )}

        {/* Inspecting state */}
        {inspecting && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 py-12 text-center">
            <div className="flex items-center gap-2">
              <span className="inspector-pulse-dot" />
              <p className="text-sm m-0" style={{ color: 'var(--color-foreground)' }}>
                Click any element on the page to inspect it
              </p>
            </div>
            <button
              className="mt-2 px-4 py-1.5 text-xs font-medium rounded-md border cursor-pointer transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--color-foreground-muted)',
                borderColor: 'var(--color-border, #d1d9e0)',
              }}
              onClick={stopInspecting}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Selected state */}
        {hasSelection && !inspecting && (
          <div className="flex flex-col flex-1 min-h-0 p-3 pt-0 gap-3">
            {/* Component name */}
            <div>
              <h3 className="text-base font-bold m-0 inspector-mono" style={{ color: 'var(--color-foreground-accent, #7655a4)' }}>
                {componentInfo.name}
              </h3>
            </div>

            {/* Source code */}
            {sourcePath && (
              <div
                className="border rounded-md overflow-hidden flex-1 min-h-0 flex flex-col"
                style={{ background: currentCodeTheme.bg, borderColor: currentCodeTheme.border }}
              >
                <div
                  className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold shrink-0"
                  style={{
                    background: currentCodeTheme.headerBg,
                    color: currentCodeTheme.headerFg,
                    borderBottom: `1px solid ${currentCodeTheme.border}`,
                  }}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <OcticonSvg name="file-code" size={12} />
                    <span className="truncate">{sourcePath}</span>
                  </span>
                  {githubUrl && (
                    <a
                      href={githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 shrink-0 text-xs no-underline hover:underline inspector-mono inspector-code-link"
                      style={{ color: currentCodeTheme.headerFg }}
                    >
                      <OcticonSvg name="mark-github" size={14} />
                      <span>GitHub</span>
                    </a>
                  )}
                </div>

                <div className="border-t flex-1 min-h-0 flex flex-col" style={{ borderColor: currentCodeTheme.border }}>
                  {sourceLoading ? (
                    <div className="px-3 py-4 text-xs text-center" style={{ color: currentCodeTheme.headerFg }}>
                      Loading source…
                    </div>
                  ) : sourceCode ? (
                    <div
                      className="flex-1 min-h-0 overflow-y-auto source-scroll-container"
                      ref={sourceContainerRef}
                      style={{
                        '--inspector-line-num-color': currentCodeTheme.comment,
                        '--inspector-line-hover': currentCodeTheme.lineHighlight,
                      }}
                    >
                      {highlightedHtml ? (
                        <div className="code-wrapper line-numbers" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
                      ) : (
                        <pre
                          className="m-0 text-xs leading-relaxed inspector-mono source-pre line-numbers"
                          style={{ background: currentCodeTheme.bg, color: currentCodeTheme.fg }}
                        >
                          <code>
                            {sourceCode.split('\n').map((line, i) => (
                              <span
                                key={i}
                                className={`line${matchedLine > 0 && i + 1 === matchedLine ? ' highlighted-line' : ''}`}
                              >
                                {line}
                                {i < sourceCode.split('\n').length - 1 ? '\n' : ''}
                              </span>
                            ))}
                          </code>
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-xs text-center" style={{ color: currentCodeTheme.headerFg }}>
                      Unable to load source
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Re-select button */}
            <button
              className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium rounded-md border-none cursor-pointer transition-colors shrink-0"
              style={{ background: 'var(--color-foreground-accent, #7655a4)', color: '#fff' }}
              onClick={startInspecting}
            >
              <OcticonSvg name="search" size={12} />
              Re-select
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
