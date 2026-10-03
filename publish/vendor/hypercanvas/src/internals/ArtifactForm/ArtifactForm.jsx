/**
 * ArtifactForm — schema-driven form that renders fields, validation, and
 * submit actions for any artifact type. Surfaces identically across the
 * command palette, canvas add menu, and workspace.
 *
 * Styling: the form is built on the BaseUiForm primitives (`@base-ui/react`
 * + workspace-style CSS) — Mona Sans, pill buttons, clean white cards.
 * This replaced the prior Primer-based implementation so artifact creation
 * shares the SimpleWorkspace look across every surface.
 *
 * Modes:
 *   <ArtifactForm type="prototype" onSubmit={fn} />   // single type
 *   <ArtifactForm onSubmit={fn} />                    // type picker
 *
 * Dynamic select options:
 *   Schemas may declare `field.dynamic = 'prototypes'`. Pass
 *   `dynamicOptions={{ prototypes: ['my-app', ...] }}` to populate them.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Form,
  Field,
  Label,
  Description,
  Validation,
  TextInput,
  Textarea,
  Select,
  Checkbox,
  Button,
  Flash,
  Menu,
} from '../BaseUiForm/BaseUiForm.jsx'
import { ARTIFACT_SCHEMAS, validateArtifact, isFieldVisible } from './artifactSchemas.js'
import styles from './ArtifactForm.module.css'

/**
 * Slugify a freeform string into the kebab-case form the `name` field expects.
 * Mirrors the NAME_PATTERN in artifactSchemas.js — lowercase letters, digits,
 * and hyphens. Used to auto-derive `name` from `title` while the user types,
 * until they manually edit `name` themselves.
 */
function slugifyName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function TypeSelector({ selected, onChange }) {
  const types = Object.entries(ARTIFACT_SCHEMAS)
  const current = ARTIFACT_SCHEMAS[selected]

  return (
    <Menu>
      <Menu.Button>
        <span>{current?.icon}</span>
        <span>{current?.label || 'Select type…'}</span>
      </Menu.Button>
      <Menu.Items>
        {types.map(([key, schema]) => (
          <Menu.Item
            key={key}
            selected={key === selected}
            onSelect={() => onChange(key)}
            description={schema.description}
          >
            <span>{schema.icon}</span>
            <span>{schema.label}</span>
          </Menu.Item>
        ))}
      </Menu.Items>
    </Menu>
  )
}

function FieldRenderer({ field, value, error, onChange, options }) {
  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <TextInput
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          type={field.type === 'url' ? 'url' : 'text'}
          invalid={!!error}
        />
      )
    case 'textarea':
      return (
        <Textarea
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          invalid={!!error}
        />
      )
    case 'code':
      return (
        <Textarea
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={8}
          className={styles.codeField}
          invalid={!!error}
        />
      )
    case 'select':
      return (
        <Select
          value={value || ''}
          onChange={val => onChange(val)}
          options={options || []}
          placeholder={field.placeholder || 'Select…'}
          invalid={!!error}
        />
      )
    case 'checkbox':
      return (
        <Checkbox checked={!!value} onChange={v => onChange(v)}>
          {field.checkboxLabel || field.label}
        </Checkbox>
      )
    default:
      return null
  }
}

function initialValues(schema) {
  const initial = {}
  if (schema) {
    for (const field of schema.fields) {
      initial[field.name] = field.default ?? ''
    }
  }
  return initial
}

/**
 * Render one Field wrapper for a schema field. Checkbox fields hide the
 * standalone label because the inline label inside the Checkbox already
 * names the control — otherwise the label appears twice. Descriptions
 * render under the input when there's no error (same pattern as
 * `patternHint`).
 */
function renderField(field, { values, errors, dynamicOptions, handleChange }) {
  const options = field.dynamic ? dynamicOptions[field.dynamic] : field.options
  const isCheckbox = field.type === 'checkbox'
  const errorMessage = errors[field.name]
  return (
    <Field key={field.name} invalid={!!errorMessage}>
      {isCheckbox
        ? <Label visuallyHidden>{field.label}</Label>
        : <Label required={field.required}>{field.label}</Label>
      }
      <FieldRenderer
        field={field}
        value={values[field.name]}
        error={errorMessage}
        onChange={val => handleChange(field.name, val)}
        options={options}
      />
      {errorMessage && <Validation>{errorMessage}</Validation>}
      {!errorMessage && (field.caption || field.patternHint) && (
        <Description>{field.caption || field.patternHint}</Description>
      )}
    </Field>
  )
}

export default function ArtifactForm({
  type: fixedType,
  onSubmit,
  onCancel,
  operation = 'create',
  compact = false,
  dynamicOptions = {},
  initialValues: initialOverride,
  hideHeader = false,
}) {
  const [selectedType, setSelectedType] = useState(fixedType || 'prototype')
  const activeType = fixedType || selectedType
  const schema = ARTIFACT_SCHEMAS[activeType]

  const [values, setValues] = useState(() => ({ ...initialValues(schema), ...(initialOverride || {}) }))
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  // Tracks whether the `name` field should keep auto-following `title`.
  // Flips to false the first time the user edits `name` directly, so we don't
  // clobber their input. Reset on type change or unmount.
  const nameAutoFollowRef = useRef(true)

  // Reset form when fixed type changes (parent-controlled)
  useEffect(() => {
    if (!fixedType) return
    setValues({ ...initialValues(ARTIFACT_SCHEMAS[fixedType]), ...(initialOverride || {}) })
    setErrors({})
    setSubmitting(false)
    nameAutoFollowRef.current = true
  }, [fixedType])

  // Merge late-arriving initial overrides (e.g. a gh-login fetch that resolves
  // after mount) into empty fields. Only fills fields the user hasn't typed
  // into yet, so we never overwrite their input. Stringify the override so the
  // dep check fires on content changes rather than parent re-render identity.
  const overrideKey = useMemo(() => JSON.stringify(initialOverride || {}), [initialOverride])
  useEffect(() => {
    if (!initialOverride || !schema) return
    setValues(prev => {
      let next = prev
      for (const [k, v] of Object.entries(initialOverride)) {
        if (v == null || v === '') continue
        const fieldExists = schema.fields.some(f => f.name === k)
        const isEmpty = prev[k] === '' || prev[k] == null
        if (fieldExists && isEmpty) {
          if (next === prev) next = { ...prev }
          next[k] = v
        }
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideKey, schema])

  // Derive `name` (kebab-case) from `title` as the user types, until they
  // manually edit `name`. Only applies to schemas that expose both fields
  // (prototype, canvas, flow). Component uses PascalCase and has no title,
  // so it's naturally excluded.
  useEffect(() => {
    if (!schema || !nameAutoFollowRef.current) return
    const hasName = schema.fields.some(f => f.name === 'name' && f.type === 'text')
    const hasTitle = schema.fields.some(f => f.name === 'title')
    if (!hasName || !hasTitle) return
    const derived = slugifyName(values.title)
    if (derived === (values.name || '')) return
    setValues(prev => ({ ...prev, name: derived }))
    if (errors.name) {
      setErrors(prev => { const next = { ...prev }; delete next.name; return next })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.title, schema])

  function handleTypeChange(newType) {
    setSelectedType(newType)
    setValues(initialValues(ARTIFACT_SCHEMAS[newType]))
    setErrors({})
    nameAutoFollowRef.current = true
  }

  const [showAdvanced, setShowAdvanced] = useState(false)

  const visibleFields = useMemo(() => {
    if (!schema) return []
    if (compact) return schema.fields.filter(f => f.required)
    let fields = schema.fields
    // Hide fields whose `showIf` predicate is not satisfied (e.g. external
    // URL only appears when the "External prototype" checkbox is on).
    fields = fields.filter(f => isFieldVisible(f, values))
    // Hide mutually-exclusive partner once one side is set
    if (schema.mutuallyExclusive) {
      fields = fields.filter(f => {
        for (const group of schema.mutuallyExclusive) {
          if (!group.includes(f.name)) continue
          const otherSet = group.find(o => o !== f.name && values[o])
          if (otherSet) return false
        }
        return true
      })
    }
    return fields
  }, [schema, compact, values])

  // Split into basic/advanced. A field with no `tier` defaults to 'basic'
  // (matches the old behaviour for any schema not yet annotated).
  const { basicFields, advancedFields } = useMemo(() => {
    const basic = []
    const advanced = []
    for (const f of visibleFields) {
      if (f.tier === 'advanced') advanced.push(f)
      else basic.push(f)
    }
    return { basicFields: basic, advancedFields: advanced }
  }, [visibleFields])

  if (!schema) {
    return (
      <Flash variant="warning">
        Unknown artifact type: <code>{activeType}</code>
      </Flash>
    )
  }

  function handleChange(fieldName, value) {
    if (fieldName === 'name') {
      nameAutoFollowRef.current = false
    }
    setValues(prev => ({ ...prev, [fieldName]: value }))
    if (errors[fieldName]) {
      setErrors(prev => { const next = { ...prev }; delete next[fieldName]; return next })
    }
    if (errors._form) {
      setErrors(prev => { const next = { ...prev }; delete next._form; return next })
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const { valid, errors: fieldErrors } = validateArtifact(activeType, values)
    if (!valid) { setErrors(fieldErrors); return }
    setSubmitting(true)
    try {
      if (onSubmit) await onSubmit({ type: activeType, operation, values })
    } catch (err) {
      setErrors({ _form: err?.message || 'Submit failed' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Form
      className={styles.formShell}
      onSubmit={handleSubmit}
      data-compact={compact || undefined}
      data-bare={hideHeader || undefined}
    >
      {!hideHeader && (
        <header className={styles.header}>
          <h3 className={styles.title}>
            {operation === 'create' ? 'New' : 'Edit'} {schema.label}
          </h3>
          {!compact && (
            <p className={styles.description}>{schema.description}</p>
          )}
        </header>
      )}

      {!fixedType && (
        <nav className={styles.typePicker}>
          <TypeSelector selected={activeType} onChange={handleTypeChange} />
        </nav>
      )}

      <div className={styles.fields}>
        {basicFields.map(field => renderField(field, {
          values, errors, dynamicOptions, handleChange,
        }))}

        {advancedFields.length > 0 && (
          <>
            <Button
              type="button"
              variant="invisible"
              size="small"
              onClick={() => setShowAdvanced(s => !s)}
              className={styles.advancedToggle}
            >
              {showAdvanced ? '− Hide advanced fields' : '+ Advanced fields'}
            </Button>
            {showAdvanced && advancedFields.map(field => renderField(field, {
              values, errors, dynamicOptions, handleChange,
            }))}
          </>
        )}
      </div>

      {errors._form && (
        <Flash variant="danger">{errors._form}</Flash>
      )}

      <footer className={styles.footer}>
        {onCancel && (
          <Button type="button" variant="invisible" onClick={onCancel} size={compact ? 'small' : 'medium'}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={submitting} size={compact ? 'small' : 'medium'}>
          {submitting ? 'Creating…' : `${operation === 'create' ? 'Create' : 'Save'} ${schema.label}`}
        </Button>
      </footer>
    </Form>
  )
}

export { TypeSelector, ARTIFACT_SCHEMAS, validateArtifact, isFieldVisible }
