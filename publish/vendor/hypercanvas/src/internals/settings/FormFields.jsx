/**
 * Reusable form field components for the settings dialog.
 * Each field maps to a config path and renders the appropriate control type.
 */
import { useState } from 'react'
import css from './SettingsDialog.module.css'

export function ToggleField({ label, description, value, onChange, disabled }) {
  return (
    <label className={`${css.fieldRow} ${disabled ? css.fieldDisabled : ''}`}>
      <div className={css.fieldInfo}>
        <span className={css.fieldLabel}>{label}</span>
        {description && <span className={css.fieldDesc}>{description}</span>}
      </div>
      <button
        type="button"
        className={`${css.toggle} ${value ? css.toggleOn : ''}`}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={!!value}
        disabled={disabled}
      >
        <span className={css.toggleKnob} />
      </button>
    </label>
  )
}

export function TextField({ label, description, value, onChange, placeholder, type = 'text', disabled }) {
  return (
    <label className={`${css.fieldRow} ${disabled ? css.fieldDisabled : ''}`}>
      <div className={css.fieldInfo}>
        <span className={css.fieldLabel}>{label}</span>
        {description && <span className={css.fieldDesc}>{description}</span>}
      </div>
      <input
        className={css.fieldInput}
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  )
}

export function NumberField({ label, description, value, onChange, min, max, step, disabled }) {
  return (
    <label className={`${css.fieldRow} ${disabled ? css.fieldDisabled : ''}`}>
      <div className={css.fieldInfo}>
        <span className={css.fieldLabel}>{label}</span>
        {description && <span className={css.fieldDesc}>{description}</span>}
      </div>
      <input
        className={css.fieldInput}
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        disabled={disabled}
      />
    </label>
  )
}

export function SelectField({ label, description, value, onChange, options, disabled }) {
  return (
    <label className={`${css.fieldRow} ${disabled ? css.fieldDisabled : ''}`}>
      <div className={css.fieldInfo}>
        <span className={css.fieldLabel}>{label}</span>
        {description && <span className={css.fieldDesc}>{description}</span>}
      </div>
      <select
        className={css.fieldSelect}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  )
}

export function JsonField({ label, description, value, onChange, disabled }) {
  const serializedValue = JSON.stringify(value ?? null, null, 2)
  const [text, setText] = useState(serializedValue)
  const [invalid, setInvalid] = useState(false)

  const handleChange = (nextText) => {
    setText(nextText)
    try {
      const parsed = JSON.parse(nextText)
      onChange(parsed)
      setInvalid(false)
    } catch {
      setInvalid(true)
    }
  }

  return (
    <div className={`${css.fieldColumn} ${disabled ? css.fieldDisabled : ''}`}>
      <div className={css.fieldInfo}>
        <span className={css.fieldLabel}>{label}</span>
        {description && <span className={css.fieldDesc}>{description}</span>}
      </div>
      <textarea
        className={css.fieldTextarea}
        value={text}
        onChange={e => handleChange(e.target.value)}
        rows={4}
        spellCheck={false}
        disabled={disabled}
      />
      {invalid && <span className={css.fieldError}>Enter valid JSON to save this field.</span>}
    </div>
  )
}

export function SectionHeader({ children }) {
  return <h3 className={css.sectionHeader}>{children}</h3>
}

export function FieldGroup({ children }) {
  return <div className={css.fieldGroup}>{children}</div>
}
