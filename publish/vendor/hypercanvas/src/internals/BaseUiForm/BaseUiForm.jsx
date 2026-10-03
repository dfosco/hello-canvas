/**
 * BaseUiForm — minimal, schema-agnostic form primitives styled in the
 * SimpleWorkspace aesthetic (Mona Sans, pill buttons, clean white cards).
 * Built on `@base-ui/react` primitives so we get accessibility and state
 * machines for free, but every visual is owned by `BaseUiForm.module.css`.
 *
 * Public exports mirror the subset of `@primer/react` previously used by
 * ArtifactForm:
 *   - <Form> form root
 *   - <Field>, <Label>, <Description>, <Validation> field grouping
 *   - <TextInput>, <Textarea>, <RangeInput>, <RadioGroup>, <DateInput>,
 *     <Select>, <Checkbox> controls
 *   - <Button>, <Flash> actions / banners
 *   - <Menu> + <Menu.Button> + <Menu.Items> + <Menu.Item> for the type picker
 */
import { forwardRef, useId } from 'react'
import { Field as BUField } from '@base-ui/react/field'
import { Select as BUSelect } from '@base-ui/react/select'
import { Checkbox as BUCheckbox } from '@base-ui/react/checkbox'
import { RadioGroup as BURadioGroup } from '@base-ui/react/radio-group'
import { Radio as BURadio } from '@base-ui/react/radio'
import { Menu as BUMenu } from '@base-ui/react/menu'
import css from './BaseUiForm.module.css'

/* ─── Form root ─── */

export const Form = forwardRef(function Form({ className, ...rest }, ref) {
  return <form ref={ref} className={`${css.form} ${className || ''}`} {...rest} />
})

/* ─── Field grouping ───
 * Wraps `@base-ui/react/field` so labels/descriptions/errors are wired
 * via aria-describedby automatically. Pass `invalid` for the error state.
 */
export function Field({ children, invalid, className, ...rest }) {
  return (
    <BUField.Root
      className={`${css.field} ${className || ''}`}
      invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </BUField.Root>
  )
}

export function Label({ children, required, visuallyHidden, ...rest }) {
  const cn = visuallyHidden ? css.labelHidden : css.label
  return (
    <BUField.Label className={cn} {...rest}>
      {children}
      {required && <span className={css.requiredMark} aria-hidden="true">*</span>}
    </BUField.Label>
  )
}

export function Description({ children, ...rest }) {
  if (!children) return null
  return (
    <BUField.Description className={css.description} {...rest}>
      {children}
    </BUField.Description>
  )
}

export function Validation({ children, ...rest }) {
  if (!children) return null
  // `match={true}` forces the error to render whenever this component is
  // mounted — we control visibility from the parent (renderField) by
  // conditionally rendering <Validation> only when there's a message.
  return (
    <BUField.Error match={true} className={css.error} {...rest}>
      {children}
    </BUField.Error>
  )
}

/* ─── Text inputs ─── */

export const TextInput = forwardRef(function TextInput(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <BUField.Control
      ref={ref}
      className={`${css.input} ${className || ''}`}
      data-invalid={invalid || undefined}
      {...rest}
    />
  )
})

export const Textarea = forwardRef(function Textarea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  // `@base-ui/react/field` Control renders an <input> by default. Use
  // `render` to swap in a textarea while keeping the aria wiring.
  return (
    <BUField.Control
      ref={ref}
      render={<textarea rows={rows} />}
      className={`${css.textarea} ${className || ''}`}
      data-invalid={invalid || undefined}
      {...rest}
    />
  )
})

export const RangeInput = forwardRef(function RangeInput(
  { className, invalid, value, onChange, min, max, step, ...rest },
  ref,
) {
  return (
    <div className={css.rangeWithValue}>
      <BUField.Control
        ref={ref}
        type="range"
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        min={min}
        max={max}
        step={step}
        className={`${css.rangeInput} ${className || ''}`}
        data-invalid={invalid || undefined}
        {...rest}
      />
      <span className={css.rangeValue} aria-hidden="true">{value}</span>
    </div>
  )
})

export const DateInput = forwardRef(function DateInput(
  { className, invalid, value, onChange, min, max, ...rest },
  ref,
) {
  return (
    <BUField.Control
      ref={ref}
      type="date"
      value={value}
      onChange={event => onChange(event.target.value)}
      min={min}
      max={max}
      className={`${css.dateInput} ${className || ''}`}
      data-invalid={invalid || undefined}
      {...rest}
    />
  )
})

/* ─── Select ───
 * Uses the BaseUI Select for a fully styled, accessible dropdown.
 * Options may be `string[]` or `{ value, label, group? }[]`. When any
 * option has a `group`, items are partitioned into <Select.Group>s with
 * a sticky label (mirrors the workshop's grouping).
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  invalid,
  modal = true,
}) {
  const norm = (options || []).map(o =>
    typeof o === 'string' ? { value: o, label: o, group: null } : { group: null, ...o },
  )
  const grouped = norm.some(o => o.group)

  const groups = grouped
    ? norm.reduce((acc, opt) => {
        const key = opt.group || 'Other'
        ;(acc[key] = acc[key] || []).push(opt)
        return acc
      }, {})
    : null

  const selectedLabel = norm.find(o => o.value === value)?.label

  return (
    <BUSelect.Root value={value || ''} onValueChange={v => onChange(v)} disabled={disabled} modal={modal}>
      <BUSelect.Trigger
        className={css.selectTrigger}
        data-invalid={invalid || undefined}
      >
        <BUSelect.Value placeholder={placeholder}>
          {() => selectedLabel || <span className={css.selectPlaceholder}>{placeholder}</span>}
        </BUSelect.Value>
        <BUSelect.Icon className={css.selectIcon}>
          <ChevronDown />
        </BUSelect.Icon>
      </BUSelect.Trigger>
      <BUSelect.Portal>
        <BUSelect.Positioner className={css.selectPositioner} sideOffset={6} alignItemWithTrigger={false}>
          <BUSelect.Popup className={css.selectPopup}>
            {grouped
              ? Object.entries(groups).map(([group, opts]) => (
                  <BUSelect.Group key={group} className={css.selectGroup}>
                    <BUSelect.GroupLabel className={css.selectGroupLabel}>{group}</BUSelect.GroupLabel>
                    {opts.map(opt => (
                      <BUSelect.Item key={opt.value} value={opt.value} className={css.selectItem}>
                        <BUSelect.ItemText>{opt.label}</BUSelect.ItemText>
                        <BUSelect.ItemIndicator className={css.selectItemIndicator}>✓</BUSelect.ItemIndicator>
                      </BUSelect.Item>
                    ))}
                  </BUSelect.Group>
                ))
              : norm.map(opt => (
                  <BUSelect.Item key={opt.value} value={opt.value} className={css.selectItem}>
                    <BUSelect.ItemText>{opt.label}</BUSelect.ItemText>
                    <BUSelect.ItemIndicator className={css.selectItemIndicator}>✓</BUSelect.ItemIndicator>
                  </BUSelect.Item>
                ))}
          </BUSelect.Popup>
        </BUSelect.Positioner>
      </BUSelect.Portal>
    </BUSelect.Root>
  )
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427z"
        fill="currentColor"
      />
    </svg>
  )
}

/* ─── Checkbox ─── */

export function Checkbox({ checked, onChange, children, disabled }) {
  const id = useId()
  return (
    <label className={css.checkboxLabel} htmlFor={id}>
      <BUCheckbox.Root
        id={id}
        checked={!!checked}
        onCheckedChange={(v) => onChange(!!v)}
        disabled={disabled}
        className={css.checkboxRoot}
      >
        <BUCheckbox.Indicator className={css.checkboxIndicator}>
          <CheckMark />
        </BUCheckbox.Indicator>
      </BUCheckbox.Root>
      <span>{children}</span>
    </label>
  )
}

export function RadioGroup({
  value,
  onChange,
  options,
  name,
  invalid,
  className,
  ...rest
}) {
  const norm = (options || []).map(option => {
    if (typeof option === 'string') return { value: option, label: option }
    const optionValue = option?.value ?? ''
    return { value: optionValue, label: option?.label ?? optionValue }
  })

  return (
    <BURadioGroup
      value={value || ''}
      onValueChange={v => onChange(v)}
      name={name}
      className={`${css.radioGroup} ${className || ''}`}
      data-invalid={invalid || undefined}
      {...rest}
    >
      {norm.map(option => (
        <label key={option.value} className={css.radioLabel}>
          <BURadio.Root value={option.value} className={css.radioRoot}>
            <BURadio.Indicator className={css.radioIndicator} />
          </BURadio.Root>
          <span>{option.label}</span>
        </label>
      ))}
    </BURadioGroup>
  )
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"
        fill="currentColor"
      />
    </svg>
  )
}

/* ─── Button ─── */

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'medium', className, type = 'button', ...rest },
  ref,
) {
  const cn = [
    css.button,
    css[`buttonVariant_${variant}`],
    css[`buttonSize_${size}`],
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return <button ref={ref} type={type} className={cn} {...rest} />
})

/* ─── Flash ─── */

export function Flash({ variant = 'info', children }) {
  return (
    <div className={`${css.flash} ${css[`flashVariant_${variant}`]}`} role="alert">
      {children}
    </div>
  )
}

/* ─── Menu (type picker dropdown) ─── */

function MenuRoot({ children }) {
  return <BUMenu.Root>{children}</BUMenu.Root>
}

function MenuButton({ children, className, ...rest }) {
  return (
    <BUMenu.Trigger className={`${css.menuButton} ${className || ''}`} {...rest}>
      <span className={css.menuButtonLabel}>{children}</span>
      <span className={css.menuButtonIcon} aria-hidden="true"><ChevronDown /></span>
    </BUMenu.Trigger>
  )
}

function MenuItems({ children }) {
  return (
    <BUMenu.Portal>
      <BUMenu.Positioner className={css.menuPositioner} sideOffset={6} align="start">
        <BUMenu.Popup className={css.menuPopup}>{children}</BUMenu.Popup>
      </BUMenu.Positioner>
    </BUMenu.Portal>
  )
}

function MenuItem({ children, onSelect, selected, description }) {
  return (
    <BUMenu.Item
      className={`${css.menuItem} ${selected ? css.menuItemSelected : ''}`}
      onClick={onSelect}
    >
      <div className={css.menuItemBody}>
        <div className={css.menuItemLabel}>{children}</div>
        {description && <div className={css.menuItemDescription}>{description}</div>}
      </div>
      {selected && <span className={css.menuItemCheck} aria-hidden="true"><CheckMark /></span>}
    </BUMenu.Item>
  )
}

export const Menu = Object.assign(MenuRoot, {
  Button: MenuButton,
  Items: MenuItems,
  Item: MenuItem,
})
