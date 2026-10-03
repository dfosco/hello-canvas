import { useState, useMemo, useEffect } from 'react'
import { Button } from '../../../lib/components/ui/button/index.js'
import { Input } from '../../../lib/components/ui/input/index.js'
import { Label } from '../../../lib/components/ui/label/index.js'
import * as Panel from '../../../lib/components/ui/panel/index.js'
import * as Alert from '../../../lib/components/ui/alert/index.js'

const STORY_SUCCESS_KEY = 'sb-story-created'

function getApiUrl() {
  const basePath = window.__STORYBOARD_BASE_PATH__ || '/'
  return basePath.replace(/\/$/, '') + '/_storyboard/canvas'
}

export default function CreateStoryForm({ onClose }) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('canvas')
  const [format, setFormat] = useState('jsx')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [createdPath, setCreatedPath] = useState(null)
  const [canvasId, setCanvasId] = useState('')

  const kebabName = useMemo(
    () => name.replace(/[^a-zA-Z0-9\s_-]/g, '').trim().replace(/[\s_]+/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, ''),
    [name]
  )

  const nameError = useMemo(() => {
    if (name.trim() && !kebabName) return 'Name must contain at least one alphanumeric character'
    if (name.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kebabName)) return 'Name must be kebab-case'
    return null
  }, [name, kebabName])

  const filePreview = kebabName ? `${kebabName}.story.${format}` : ''
  const canSubmit = !!kebabName && !nameError && !submitting

  useEffect(() => {
    try {
      const bridgeState = window.__storyboardCanvasBridgeState
      if (bridgeState?.canvasId) setCanvasId(bridgeState.canvasId)
      else if (bridgeState?.name) setCanvasId(bridgeState.name)
    } catch { /* empty */ }

    try {
      const saved = sessionStorage.getItem(STORY_SUCCESS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        setSuccess(parsed.success)
        setCreatedPath(parsed.path)
        sessionStorage.removeItem(STORY_SUCCESS_KEY)
      }
    } catch { /* empty */ }
  }, [])

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    setCreatedPath(null)
    try {
      const res = await fetch(getApiUrl() + '/create-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: kebabName,
          location,
          format,
          canvasName: location === 'canvas' ? canvasId : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to create story'); return }
      setSuccess(`Created ${data.path}`)
      setCreatedPath(data.path)
      try {
        sessionStorage.setItem(STORY_SUCCESS_KEY, JSON.stringify({
          success: `Created ${data.name}.story.${format}`,
          path: data.path,
        }))
      } catch { /* empty */ }
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && canSubmit) submit()
  }

  return (
    <>
      <Panel.Header>
        <Panel.Title>Create story</Panel.Title>
        <Panel.Close />
      </Panel.Header>

      <div className="p-4 pt-2 space-y-3" onKeyDown={handleKeydown}>
        <div className="space-y-1">
          <Label htmlFor="sb-story-name">Component name</Label>
          <Input
            id="sb-story-name"
            placeholder="e.g. user-card"
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          {filePreview && (
            <p className="text-xs text-muted-foreground">
              File: <code className="px-1 py-0.5 bg-muted rounded font-mono text-foreground text-xs">{filePreview}</code>
            </p>
          )}
        </div>

        <fieldset className="space-y-1.5">
          <Label>Location</Label>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="sb-story-location"
                value="canvas"
                checked={location === 'canvas'}
                onChange={() => setLocation('canvas')}
                className="accent-primary"
              />
              This canvas directory
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="sb-story-location"
                value="components"
                checked={location === 'components'}
                onChange={() => setLocation('components')}
                className="accent-primary"
              />
              <code className="text-xs bg-muted px-1 py-0.5 rounded">src/components/</code>
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <Label>Format</Label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="sb-story-format"
                value="jsx"
                checked={format === 'jsx'}
                onChange={() => setFormat('jsx')}
                className="accent-primary"
              />
              JSX
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="sb-story-format"
                value="tsx"
                checked={format === 'tsx'}
                onChange={() => setFormat('tsx')}
                className="accent-primary"
              />
              TSX
            </label>
          </div>
        </fieldset>

        {error && (
          <Alert.Root variant="destructive">
            <Alert.Description>{error}</Alert.Description>
          </Alert.Root>
        )}
        {success && (
          <Alert.Root>
            <Alert.Description className="text-success">
              {success}
              {createdPath && (
                <>
                  <br />
                  <span className="text-xs text-muted-foreground">
                    To edit your component, go to{' '}
                    <code className="px-1 py-0.5 bg-muted rounded font-mono text-xs">{createdPath}</code>
                  </span>
                </>
              )}
            </Alert.Description>
          </Alert.Root>
        )}
      </div>

      <Panel.Footer>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {submitting ? 'Creating\u2026' : 'Create'}
        </Button>
      </Panel.Footer>
    </>
  )
}
