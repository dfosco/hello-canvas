import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from '../../../lib/components/ui/button/index.js'
import { Input } from '../../../lib/components/ui/input/index.js'
import { Label } from '../../../lib/components/ui/label/index.js'
import * as Panel from '../../../lib/components/ui/panel/index.js'
import * as DropdownMenu from '../../../lib/components/ui/dropdown-menu/index.js'
import * as Alert from '../../../lib/components/ui/alert/index.js'

function getApiUrl() {
  const basePath = window.__STORYBOARD_BASE_PATH__ || '/'
  return basePath.replace(/\/$/, '') + '/_storyboard/workshop/pages'
}

export default function CreatePageForm({ onClose }) {
  const [selectedPrototype, setSelectedPrototype] = useState('')
  const [pagePath, setPagePath] = useState('')
  const [template, setTemplate] = useState('')
  const [prototypes, setPrototypes] = useState([])
  const [partials, setPartials] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)

  const selectedProtoEntry = useMemo(
    () => (selectedPrototype ? prototypes.find((p) => p.name === selectedPrototype) : null),
    [selectedPrototype, prototypes]
  )
  const pagePrefix = selectedPrototype ? `/${selectedPrototype}/` : '/prototype-name/'
  const pageSuffix = pagePath.startsWith(pagePrefix) ? pagePath.slice(pagePrefix.length) : pagePath
  const canSubmit = !!selectedPrototype && !!pageSuffix.trim() && !submitting

  const templateChoices = useMemo(
    () =>
      selectedPrototype
        ? partials.filter((p) => {
            if (p.scope === 'global') return true
            return (
              p.prototype === selectedPrototype &&
              (p.folder || '') === (selectedProtoEntry?.folder || '')
            )
          })
        : partials.filter((p) => p.scope === 'global'),
    [selectedPrototype, partials, selectedProtoEntry]
  )

  const globalTemplateChoices = useMemo(
    () => templateChoices.filter((p) => p.scope === 'global'),
    [templateChoices]
  )
  const localTemplateChoices = useMemo(
    () => templateChoices.filter((p) => p.scope === 'prototype'),
    [templateChoices]
  )
  const localTemplateHeading = selectedPrototype || ''
  const globalTemplates = useMemo(
    () => globalTemplateChoices.filter((p) => p.kind === 'template'),
    [globalTemplateChoices]
  )
  const globalRecipes = useMemo(
    () => globalTemplateChoices.filter((p) => p.kind === 'recipe'),
    [globalTemplateChoices]
  )
  const localTemplates = useMemo(
    () => localTemplateChoices.filter((p) => p.kind === 'template'),
    [localTemplateChoices]
  )
  const localRecipes = useMemo(
    () => localTemplateChoices.filter((p) => p.kind === 'recipe'),
    [localTemplateChoices]
  )
  const templateLabel = template
    ? templateChoices.find((c) => c.id === template)?.name ?? template
    : 'Blank page'

  // Fetch prototypes and partials on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(getApiUrl())
        if (res.ok && !cancelled) {
          const data = await res.json()
          setPrototypes(data.prototypes || [])
          setPartials(data.partials || [])
        }
      } catch {
        /* defaults */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // When selectedPrototype changes, reset pagePath
  useEffect(() => {
    if (!selectedPrototype) {
      setPagePath('')
      return
    }
    const prefix = `/${selectedPrototype}/`
    setPagePath((prev) => (!prev || !prev.startsWith(prefix)) ? `${prefix}new-page` : prev)
  }, [selectedPrototype])

  // When template no longer available, clear it
  useEffect(() => {
    if (!template) return
    if (!templateChoices.some((c) => c.id === template)) setTemplate('')
  }, [template, templateChoices])

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prototype: selectedPrototype,
          folder: selectedProtoEntry?.folder || undefined,
          path: pagePath.trim(),
          template: template || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create page')
        return
      }
      setSuccess(`Created ${data.path}`)
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, selectedPrototype, selectedProtoEntry, pagePath, template])

  function handleKeydown(e) {
    if (e.key === 'Enter' && canSubmit) submit()
  }

  return (
    <>
      <Panel.Header>
        <Panel.Title>Create page</Panel.Title>
        <Panel.Close />
      </Panel.Header>

      <div className="p-4 pt-2 space-y-5" onKeyDown={handleKeydown}>
        <div className="space-y-1">
          <Label htmlFor="sb-page-prototype">Prototype</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            id="sb-page-prototype"
            value={selectedPrototype}
            onChange={(e) => setSelectedPrototype(e.target.value)}
            disabled={loading}
          >
            <option value="">Select prototype</option>
            {prototypes.map((p) => (
              <option key={p.name} value={p.name}>
                {p.folder ? `${p.folder} / ${p.name}` : p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="sb-page-path">Page path</Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
              {pagePrefix}
            </span>
            <Input
              id="sb-page-path"
              placeholder="new-page"
              value={pageSuffix}
              onChange={(e) => {
                const suffix = e.target.value.replace(/^\/+/, '')
                setPagePath(`${pagePrefix}${suffix}`)
              }}
              disabled={!selectedPrototype}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Template / recipe</Label>
          <DropdownMenu.Root open={templateMenuOpen} onOpenChange={setTemplateMenuOpen}>
            <DropdownMenu.Trigger asChild>
              <button
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!selectedPrototype}
              >
                <span className={template ? 'text-foreground' : 'text-muted-foreground'}>
                  {templateLabel}
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content side="left" align="start" sideOffset={8} className="min-w-[220px]">
              {template && (
                <>
                  <DropdownMenu.Item onSelect={() => { setTemplate(''); setTemplateMenuOpen(false) }}>
                    <span className="text-muted-foreground">Blank page</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                </>
              )}

              {globalTemplates.length > 0 && (
                <DropdownMenu.Group>
                  <DropdownMenu.GroupHeading>Templates</DropdownMenu.GroupHeading>
                  {globalTemplates.map((item) => (
                    <DropdownMenu.Item key={item.id} onSelect={() => { setTemplate(item.id); setTemplateMenuOpen(false) }}>
                      {item.name}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Group>
              )}

              {localTemplates.length > 0 && (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Group>
                    <DropdownMenu.GroupHeading>{localTemplateHeading} / Templates</DropdownMenu.GroupHeading>
                    {localTemplates.map((item) => (
                      <DropdownMenu.Item key={item.id} onSelect={() => { setTemplate(item.id); setTemplateMenuOpen(false) }}>
                        {item.name}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Group>
                </>
              )}

              {globalRecipes.length > 0 && (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Group>
                    <DropdownMenu.GroupHeading>Recipes</DropdownMenu.GroupHeading>
                    {globalRecipes.map((item) => (
                      <DropdownMenu.Item key={item.id} onSelect={() => { setTemplate(item.id); setTemplateMenuOpen(false) }}>
                        {item.name}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Group>
                </>
              )}

              {localRecipes.length > 0 && (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Group>
                    <DropdownMenu.GroupHeading>{localTemplateHeading} / Recipes</DropdownMenu.GroupHeading>
                    {localRecipes.map((item) => (
                      <DropdownMenu.Item key={item.id} onSelect={() => { setTemplate(item.id); setTemplateMenuOpen(false) }}>
                        {item.name}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Group>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>

        {error && (
          <Alert.Root variant="destructive">
            <Alert.Description>{error}</Alert.Description>
          </Alert.Root>
        )}
        {success && (
          <Alert.Root>
            <Alert.Description className="text-success">{success}</Alert.Description>
          </Alert.Root>
        )}
      </div>

      <Panel.Footer>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {submitting ? 'Creating…' : 'Create page'}
        </Button>
      </Panel.Footer>
    </>
  )
}
