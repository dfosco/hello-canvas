/**
 * CreateDialog — Primer Dialog wrapper around CreateArtifactForm.
 *
 * The form, fields, validation, data-loading, and submission live in
 * `CreateArtifactForm`. This component just supplies the modal chrome.
 */
import Dialog from '../Dialog.jsx'
import CreateArtifactForm, { ARTIFACT_SCHEMAS } from './CreateArtifactForm.jsx'
import { resolveSchemaKey, TYPE_KEY_MAP } from './createHelpers.js'
import SiteForm from '../SiteForm/SiteForm.jsx'

export default function CreateDialog({ type, basePath, initialValues = null, onClose }) {
  // `type === null`/`undefined` means "no dialog requested" — render nothing.
  // Explicit `'Any'` (or empty string) means picker mode.
  if (type == null) return null

  if (String(type).toLowerCase() === 'site') return (
    <Dialog title={initialValues ? 'Create Site from pasted URL' : 'New Site'} subtitle={initialValues ? 'Choose the project directory, then review the detected Site URL and run command.' : 'Connect a local directory as a Site.'} onClose={onClose} width="large">
      <SiteForm initialValues={initialValues || {}} basePath={basePath} onClose={onClose} onSaved={site => {
        onClose?.()
        if (!site?.id) return
        if (Object.prototype.hasOwnProperty.call(initialValues || {}, 'route')) {
          document.dispatchEvent(new CustomEvent('storyboard:site-created-from-paste', {
            detail: { site, route: initialValues.route || '' },
          }))
          return
        }
        const base = (basePath || '/').replace(/\/+$/, '')
        window.location.href = `${base}/sites/${encodeURIComponent(site.id)}/`
      }} />
    </Dialog>
  )

  const schemaKey = resolveSchemaKey(type)
  const isPicker = schemaKey === null
  const schema = schemaKey ? ARTIFACT_SCHEMAS[schemaKey] : null

  if (!isPicker && !schema) return null

  return (
    <Dialog
      title={isPicker ? 'New artifact' : `New ${schema.label}`}
      subtitle={isPicker ? 'Pick an artifact type to create.' : schema.description}
      onClose={onClose}
      width="large"
    >
      <CreateArtifactForm
        type={type}
        basePath={basePath}
        initialValues={initialValues}
        onClose={onClose}
        hideHeader
      />
    </Dialog>
  )
}

// Re-export for canvas/workspace integrations
export { ARTIFACT_SCHEMAS as CREATE_SCHEMAS, TYPE_KEY_MAP }
