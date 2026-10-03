/**
 * KnobsForm — schema-driven live form for typed Storyboard knobs.
 *
 * Renders the same BaseUiForm controls for toolbar panels and canvas widgets,
 * reads current values from URL hash overrides, and writes every edit
 * immediately through the iframe-safe knobs writer.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
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
  RangeInput,
  RadioGroup,
  DateInput,
} from '../BaseUiForm/BaseUiForm.jsx'
import { useOverride } from '../hooks/useOverride.js'
import {
  buildKnobKey,
  clearKnobValue,
  coerceByType,
  flattenKnobs,
  isKnobHighlightEnabled,
  normalizeScope,
  resolveKnobColor,
  serializeKnobValue,
  setKnobValue,
} from '../../core/knobs/index.js'
import styles from './KnobsForm.module.css'

const DEFAULT_EMPTY_MESSAGE = 'No knobs are available for this selection yet.'

function humanize(value) {
  const last = String(value || '').split('.').pop()
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, char => char.toUpperCase())
}

function knobLabel(def) {
  return def?.label || humanize(def?.id)
}

function targetWindowFrom(target) {
  try {
    if (!target) return null
    if (target.location && typeof target.addEventListener === 'function') return target
    if (target.contentWindow?.location) return target.contentWindow
  } catch {
    return null
  }
  return null
}

function readHashParam(targetWindow, key) {
  try {
    return new URLSearchParams(targetWindow.location.hash.replace(/^#/, '')).get(key)
  } catch {
    return null
  }
}

function notifyHashChange(targetWindow) {
  // Construct the event using the TARGET window's own constructors when
  // available — cross-realm Event instances are not received reliably by
  // listeners attached inside the target frame (especially Safari).
  try {
    const Ctor = targetWindow.HashChangeEvent || HashChangeEvent
    targetWindow.dispatchEvent(new Ctor('hashchange'))
    return
  } catch { /* fall through */ }
  try {
    const Ctor = targetWindow.Event || Event
    targetWindow.dispatchEvent(new Ctor('hashchange'))
  } catch { /* ignore */ }
}

function routeForDef(def, route) {
  if (route !== undefined) return normalizeScope(route)
  return normalizeScope(def?.scope)
}

function defaultValueFor(def) {
  if (def?.default !== undefined) return def.default

  switch (def?.type) {
    case 'boolean':
      return false
    case 'number':
    case 'slider':
      return def?.min ?? ''
    case 'range':
      return [def?.min ?? '', def?.max ?? '']
    case 'string-array':
      return []
    case 'text':
    case 'textarea':
    case 'select':
    case 'radio':
    case 'date':
    default:
      return ''
  }
}

function optionValue(option) {
  if (option && typeof option === 'object' && 'value' in option) return option.value
  return option
}

function numberValue(value, fallback = '') {
  if (value == null || value === '') return fallback
  return Number.isNaN(Number(value)) ? fallback : Number(value)
}

function clampNumber(value, def) {
  if (value === '') return ''
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return value

  let clamped = numeric
  if (def?.min !== undefined) clamped = Math.max(Number(def.min), clamped)
  if (def?.max !== undefined) clamped = Math.min(Number(def.max), clamped)
  return clamped
}

function validateRawValue(rawValue, def, coercedValue) {
  if (def?.type === 'slider' && (def.min === undefined || def.max === undefined)) {
    return 'Slider knobs require min and max values.'
  }

  if (rawValue == null || (def?.type === 'string-array' && rawValue === '')) return null

  if (coercedValue === undefined) {
    if (def?.type === 'select' || def?.type === 'radio') return 'Choose one of the available options.'
    if (def?.type === 'date') return 'Enter a valid date in YYYY-MM-DD format.'
    if (def?.type === 'string-array') return 'Enter a valid string array.'
    if (def?.type === 'boolean') return 'Expected true or false.'
    return 'Enter a valid value.'
  }

  if (def?.type === 'number' || def?.type === 'slider') {
    if (def.min !== undefined && coercedValue < Number(def.min)) return `Must be at least ${def.min}.`
    if (def.max !== undefined && coercedValue > Number(def.max)) return `Must be at most ${def.max}.`
  }

  if (def?.type === 'range' && Array.isArray(coercedValue)) {
    const [minValue, maxValue] = coercedValue
    if (minValue > maxValue) return 'Minimum must be less than or equal to maximum.'
    if (def.min !== undefined && (minValue < Number(def.min) || maxValue < Number(def.min))) {
      return `Values must be at least ${def.min}.`
    }
    if (def.max !== undefined && (minValue > Number(def.max) || maxValue > Number(def.max))) {
      return `Values must be at most ${def.max}.`
    }
  }

  if (def?.type === 'date') {
    if (def.min && coercedValue < def.min) return `Date must be on or after ${def.min}.`
    if (def.max && coercedValue > def.max) return `Date must be on or before ${def.max}.`
  }

  return null
}

function useTargetHashValue(key, targetWindow) {
  const subscribe = useCallback((callback) => {
    if (!targetWindow) return () => {}
    targetWindow.addEventListener('hashchange', callback)
    return () => targetWindow.removeEventListener('hashchange', callback)
  }, [targetWindow])

  const getSnapshot = useCallback(() => {
    if (!targetWindow) return null
    return readHashParam(targetWindow, key)
  }, [key, targetWindow])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useKnobValue(def, { target, route } = {}) {
  const targetWindow = targetWindowFrom(target)
  const isCrossWindow = !!(targetWindow && targetWindow !== window)
  const resolvedRoute = routeForDef(def, route)
  const key = buildKnobKey(def.id, { route: resolvedRoute })
  // Same-window: use the shared override store (storage shadow, hide-mode
  // hot-swap, useSyncExternalStore reactivity, etc.). Cross-window
  // (canvas widget → iframe): subscribe directly to the iframe's hashchange.
  const [localRawValue, setOverride, clearOverride] = useOverride(key)
  const targetRawValue = useTargetHashValue(key, isCrossWindow ? targetWindow : null)
  const rawValue = isCrossWindow ? targetRawValue : localRawValue
  const coercedValue = coerceByType(rawValue, def)
  const defaultValue = defaultValueFor(def)
  const value = coercedValue !== undefined ? coercedValue : defaultValue
  const error = validateRawValue(rawValue, def, coercedValue)

  return {
    key,
    route: resolvedRoute,
    targetWindow,
    isCrossWindow,
    rawValue,
    value,
    defaultValue,
    error,
    hasOverride: rawValue != null,
    setOverride,
    clearOverride,
  }
}

function scopeKey(def) {
  return normalizeScope(def?.scope) || ''
}

function sameScope(left, right) {
  return scopeKey(left) === scopeKey(right)
}

function isChildOf(parent, child) {
  if (!parent || !child || !sameScope(parent, child)) return false
  return child.id.startsWith(`${parent.id}.`)
}

function isImmediateChildOf(parent, child) {
  if (!isChildOf(parent, child)) return false
  const rest = child.id.slice(parent.id.length + 1)
  return rest.length > 0 && !rest.includes('.')
}

function hasObjectAncestor(def, allKnobs) {
  const parts = String(def.id).split('.')
  for (let index = 1; index < parts.length; index += 1) {
    const ancestorId = parts.slice(0, index).join('.')
    const ancestor = allKnobs.find(candidate =>
      candidate.type === 'object' &&
      candidate.id === ancestorId &&
      sameScope(candidate, def)
    )
    if (ancestor) return true
  }
  return false
}

function rootKnobs(allKnobs) {
  return allKnobs.filter(def => !hasObjectAncestor(def, allKnobs))
}

function childKnobs(parent, allKnobs) {
  return allKnobs.filter(def => isImmediateChildOf(parent, def))
}

function groupSections(knobs) {
  const sections = []
  for (const def of knobs) {
    const key = scopeKey(def)
    let section = sections.find(candidate => candidate.key === key)
    if (!section) {
      section = { key, label: key, knobs: [] }
      sections.push(section)
    }
    section.knobs.push(def)
  }
  return sections
}

function RangeTupleInput({ def, value, error, onChange }) {
  const label = knobLabel(def)
  const tuple = Array.isArray(value) ? value : ['', '']

  function updateAt(index, nextValue) {
    const next = [...tuple]
    next[index] = clampNumber(nextValue, def)
    onChange(next)
  }

  return (
    <div className={styles.rangeTuple}>
      <label className={styles.rangeTupleItem}>
        <span>min</span>
        <TextInput
          type="number"
          value={tuple[0] ?? ''}
          onChange={event => updateAt(0, event.target.value)}
          min={def.min}
          max={def.max}
          step={def.step}
          aria-label={`${label} min`}
          invalid={!!error}
        />
      </label>
      <label className={styles.rangeTupleItem}>
        <span>max</span>
        <TextInput
          type="number"
          value={tuple[1] ?? ''}
          onChange={event => updateAt(1, event.target.value)}
          min={def.min}
          max={def.max}
          step={def.step}
          aria-label={`${label} max`}
          invalid={!!error}
        />
      </label>
    </div>
  )
}

function StringArrayInput({ def, value, error, onChange }) {
  const label = knobLabel(def)
  const items = Array.isArray(value) ? value : []

  function updateItem(index, nextValue) {
    const next = items.slice()
    next[index] = nextValue
    onChange(next)
  }

  function removeItem(index) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index))
  }

  return (
    <div className={styles.arrayEditor}>
      {items.map((item, index) => (
        <div key={`${index}-${items.length}`} className={styles.arrayRow}>
          <TextInput
            value={item || ''}
            onChange={event => updateItem(index, event.target.value)}
            aria-label={`${label} item ${index + 1}`}
            invalid={!!error}
          />
          <Button
            type="button"
            variant="invisible"
            size="small"
            className={styles.arrayRemove}
            onClick={() => removeItem(index)}
            aria-label={`Remove ${label} item ${index + 1}`}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="small"
        className={styles.arrayAdd}
        onClick={() => onChange([...items, ''])}
      >
        + Add
      </Button>
    </div>
  )
}

function FieldRenderer({ def, state, onChange }) {
  const value = state.value
  const invalid = !!state.error

  switch (def.type) {
    case 'text':
      return (
        <TextInput
          value={value || ''}
          onChange={event => onChange(event.target.value)}
          placeholder={def.placeholder}
          invalid={invalid}
        />
      )
    case 'textarea':
      return (
        <Textarea
          value={value || ''}
          onChange={event => onChange(event.target.value)}
          placeholder={def.placeholder}
          rows={def.rows || 3}
          invalid={invalid}
        />
      )
    case 'number':
      return (
        <TextInput
          type="number"
          value={value ?? ''}
          onChange={event => onChange(clampNumber(event.target.value, def))}
          placeholder={def.placeholder}
          min={def.min}
          max={def.max}
          step={def.step}
          invalid={invalid}
        />
      )
    case 'slider': {
      const min = numberValue(def.min, 0)
      const max = numberValue(def.max, 100)
      const sliderValue = numberValue(value, min)
      return (
        <RangeInput
          value={sliderValue}
          onChange={nextValue => onChange(clampNumber(nextValue, def))}
          min={min}
          max={max}
          step={def.step}
          invalid={invalid}
        />
      )
    }
    case 'boolean': {
      const onLabel = def.onLabel ?? 'Enabled'
      const offLabel = def.offLabel ?? 'Disabled'
      return (
        <Checkbox checked={!!value} onChange={nextValue => onChange(nextValue)}>
          {value ? onLabel : offLabel}
        </Checkbox>
      )
    }
    case 'select':
      return (
        <Select
          value={value || ''}
          onChange={nextValue => onChange(nextValue)}
          options={def.options || []}
          placeholder={def.placeholder || 'Select…'}
          invalid={invalid}
          modal={false}
        />
      )
    case 'radio':
      return (
        <RadioGroup
          value={value || ''}
          onChange={nextValue => onChange(nextValue)}
          options={def.options || []}
          name={state.key}
          invalid={invalid}
        />
      )
    case 'range':
      return <RangeTupleInput def={def} value={value} error={state.error} onChange={onChange} />
    case 'date':
      return (
        <DateInput
          value={value || ''}
          onChange={nextValue => onChange(nextValue)}
          min={def.min}
          max={def.max}
          invalid={invalid}
        />
      )
    case 'string-array':
      return <StringArrayInput def={def} value={value} error={state.error} onChange={onChange} />
    default:
      return <p className={styles.unsupported}>Unsupported knob type: {def.type || 'unknown'}</p>
  }
}

function KnobDot({ color }) {
  return (
    <span
      className={styles.knobDot}
      style={{ background: color }}
      aria-hidden="true"
    />
  )
}

function KnobField({ def, allKnobs, target, route }) {
  const state = useKnobValue(def, { target, route })
  const label = knobLabel(def)
  const highlightEnabled = isKnobHighlightEnabled(def)
  const dotColor = highlightEnabled ? resolveKnobColor(def) : null

  const writeValue = useCallback((nextValue) => {
    if (state.isCrossWindow) {
      // Canvas widget case: push to the target iframe's hash only.
      // Don't mirror locally — the canvas page isn't where the prototype reads.
      setKnobValue(def.id, nextValue, {
        route: state.route,
        target: state.targetWindow,
        def,
      })
      notifyHashChange(state.targetWindow)
    } else {
      // Same-window case (toolbar panel): write through useOverride so the
      // shared store + localStorage shadow are kept in sync and any local
      // `useKnob` consumer re-renders synchronously.
      state.setOverride(serializeKnobValue(nextValue, def))
    }
  }, [def, state])

  if (def.type === 'object') {
    const children = childKnobs(def, allKnobs)

    return (
      <fieldset
        className={styles.objectField}
        style={highlightEnabled ? { '--sb-knob-color': dotColor } : undefined}
      >
        <legend className={styles.knobLegend}>
          <span className={styles.knobLabelText}>{label}</span>
          {highlightEnabled && <KnobDot color={dotColor} />}
        </legend>
        {def.description && <p className={styles.objectDescription}>{def.description}</p>}
        <KnobsFields
          allKnobs={allKnobs}
          parentDef={def}
          target={target}
          route={route}
          nested
        />
        {children.length === 0 && (
          <p className={styles.objectDescription}>No nested knobs are defined.</p>
        )}
      </fieldset>
    )
  }

  const optionValues = Array.isArray(def.options) ? def.options.map(optionValue) : []

  return (
    <Field
      invalid={!!state.error}
      className={styles.knobField}
      data-knob-id={def.id}
      style={highlightEnabled ? { '--sb-knob-color': dotColor } : undefined}
    >
      <Label className={styles.knobLabel}>
        <span className={styles.knobLabelText}>{label}</span>
        {highlightEnabled && <KnobDot color={dotColor} />}
      </Label>
      <FieldRenderer def={def} state={state} onChange={writeValue} />
      {state.error && <Validation>{state.error}</Validation>}
      {!state.error && def.description && <Description>{def.description}</Description>}
      {!state.error && optionValues.length === 0 && (def.type === 'select' || def.type === 'radio') && (
        <Validation>No options are defined for this knob.</Validation>
      )}
    </Field>
  )
}

function KnobsFields({ knobs = [], allKnobs, parentDef, target, route, nested = false }) {
  const flatKnobs = useMemo(() => allKnobs || flattenKnobs(knobs), [allKnobs, knobs])
  const visibleKnobs = useMemo(() => (
    parentDef ? childKnobs(parentDef, flatKnobs) : rootKnobs(flatKnobs)
  ), [flatKnobs, parentDef])

  if (nested) {
    return (
      <div className={styles.nestedFields}>
        {visibleKnobs.map(def => (
          <KnobField
            key={`${scopeKey(def)}:${def.id}`}
            def={def}
            allKnobs={flatKnobs}
            target={target}
            route={route}
          />
        ))}
      </div>
    )
  }

  const sections = groupSections(visibleKnobs)

  return (
    <div className={styles.sections}>
      {sections.map(section => (
        <section key={section.key || 'default'} className={styles.section}>
          {section.label && <h3 className={styles.sectionHeader}>{section.label}</h3>}
          <div className={styles.fields}>
            {section.knobs.map(def => (
              <KnobField
                key={`${scopeKey(def)}:${def.id}`}
                def={def}
                allKnobs={flatKnobs}
                target={target}
                route={route}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ResetAllButton({ knobs, target }) {
  const targetWindow = targetWindowFrom(target)
  const isCrossWindow = !!(targetWindow && targetWindow !== window)

  const handleReset = useCallback(() => {
    const flat = flattenKnobs(knobs).filter(def => def.type !== 'object')
    if (isCrossWindow) {
      for (const def of flat) {
        clearKnobValue(def.id, {
          route: normalizeScope(def.scope),
          target: targetWindow,
        })
      }
      notifyHashChange(targetWindow)
    } else {
      for (const def of flat) {
        clearKnobValue(def.id, { route: normalizeScope(def.scope) })
      }
      notifyHashChange(window)
    }
  }, [knobs, isCrossWindow, targetWindow])

  return (
    <div className={styles.resetAll}>
      <Button
        type="button"
        variant="invisible"
        size="small"
        onClick={handleReset}
      >
        Reset to defaults
      </Button>
    </div>
  )
}

export default function KnobsForm({
  knobs = [],
  target = null,
  route,
  className,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
}) {
  const safeKnobs = Array.isArray(knobs) ? knobs : []

  if (safeKnobs.length === 0) {
    return (
      <div className={`${styles.emptyState} ${className || ''}`}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <Form
      className={`${styles.formShell} ${className || ''}`}
      onSubmit={event => event.preventDefault()}
    >
      <KnobsFields knobs={safeKnobs} target={target} route={route} />
      <ResetAllButton knobs={safeKnobs} target={target} />
    </Form>
  )
}
