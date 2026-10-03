/**
 * CreateArtifactForm — shared form body for the artifact create UI.
 *
 * Wraps `ArtifactForm` with the data-loading, gh-author prefill, payload
 * shaping, and post-submit navigation logic. Used by both the in-app
 * modal (`CreateDialog`) and the standalone full-page route
 * (`CreatePage`). Picker mode (no `type`) is supported — ArtifactForm
 * renders its TypeSelector and the submit handler resolves the schema
 * from the form callback.
 */
import { useState, useEffect, useMemo } from 'react'
import ArtifactForm, { ARTIFACT_SCHEMAS, isFieldVisible } from '../ArtifactForm/ArtifactForm.jsx'
import { resolveSchemaKey, withBase } from './createHelpers.js'

export default function CreateArtifactForm({
  type,
  basePath,
  onClose,
  hideHeader = true,
}) {
  const schemaKey = resolveSchemaKey(type)
  const isPicker = schemaKey === null
  const fixedSchema = schemaKey ? ARTIFACT_SCHEMAS[schemaKey] : null

  const [prototypes, setPrototypes] = useState([])
  const [partials, setPartials] = useState([])
  const [ghLogin, setGhLogin] = useState(null)

  // In picker mode we don't yet know the schema, so load everything that
  // any schema might need. For a fixed type we only load what's required.
  const needsPrototypes = useMemo(() => {
    if (isPicker) return true
    return fixedSchema?.fields.some(f => f.dynamic === 'prototypes') || false
  }, [isPicker, fixedSchema])

  const needsPartials = useMemo(() => {
    if (isPicker) return true
    return fixedSchema?.fields.some(f => f.dynamic === 'partials') || false
  }, [isPicker, fixedSchema])

  const needsAuthor = useMemo(() => {
    if (isPicker) return true
    return fixedSchema?.fields.some(f => f.name === 'author') || false
  }, [isPicker, fixedSchema])

  useEffect(() => {
    if (!needsPrototypes) return
    const apiBase = (basePath || '/').replace(/\/+$/, '')
    fetch(`${apiBase}/_storyboard/artifact/list?type=prototype`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data?.items) setPrototypes(data.items.map(p => p.name)) })
      .catch(() => {})
  }, [needsPrototypes, basePath])

  useEffect(() => {
    if (!needsPartials) return
    const apiBase = (basePath || '/').replace(/\/+$/, '')
    fetch(`${apiBase}/_storyboard/workshop/prototypes`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data?.partials) return
        // Group by scope+kind: "Templates" / "Recipes" for global, "<proto> / Templates" etc. for local.
        const opts = data.partials.map(p => {
          const kindLabel = p.kind === 'recipe' ? 'Recipes' : 'Templates'
          const group = p.scope === 'global'
            ? kindLabel
            : `${p.folder ? p.folder + ' / ' : ''}${p.prototype || 'local'} / ${kindLabel}`
          return { value: p.id, label: p.name, group }
        })
        setPartials(opts)
      })
      .catch(() => {})
  }, [needsPartials, basePath])

  useEffect(() => {
    if (!needsAuthor) return
    const apiBase = (basePath || '/').replace(/\/+$/, '')
    fetch(`${apiBase}/_storyboard/git-user`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data?.login) setGhLogin(data.login) })
      .catch(() => {})
  }, [needsAuthor, basePath])

  // Late-arriving gh login is merged into empty fields inside ArtifactForm.
  const initialValues = useMemo(() => {
    if (!needsAuthor || !ghLogin) return undefined
    return { author: ghLogin }
  }, [needsAuthor, ghLogin])

  if (!isPicker && !fixedSchema) return null

  async function handleSubmit({ type: t, values }) {
    const apiBase = (basePath || '/').replace(/\/+$/, '')
    const endpoint = `${apiBase}/_storyboard/artifact/`

    // In picker mode the schema is decided by the form; resolve it now.
    const submittedSchema = ARTIFACT_SCHEMAS[t] || fixedSchema
    if (!submittedSchema) throw new Error(`Unknown artifact type: ${t}`)

    const payload = { type: t }
    for (const field of submittedSchema.fields) {
      // Skip UI-only fields (e.g. the `external` toggle on prototype —
      // the server infers external mode from the presence of `url`).
      if (field.uiOnly) continue
      // Skip fields hidden by `showIf` so we never send a stale value
      // for a field the user can't see (e.g. `url` when external is off).
      if (!isFieldVisible(field, values)) continue
      const val = values[field.name]
      if (field.type === 'checkbox') {
        if (val) payload[field.name] = true
      } else if (typeof val === 'string') {
        const trimmed = val.trim()
        if (trimmed) payload[field.name] = trimmed
      } else if (val != null) {
        payload[field.name] = val
      }
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || `Request failed (${res.status})`)
    }
    const data = await res.json().catch(() => ({}))
    // Navigate only if the server gave us an explicit route. Types without
    // a route (object/record/component) just close the form.
    if (data.route) {
      window.location.href = withBase(basePath, data.route)
    } else {
      onClose?.()
    }
  }

  return (
    <ArtifactForm
      type={isPicker ? undefined : schemaKey}
      onSubmit={handleSubmit}
      onCancel={onClose}
      dynamicOptions={{ prototypes, partials }}
      initialValues={initialValues}
      hideHeader={hideHeader}
    />
  )
}

export { ARTIFACT_SCHEMAS }
