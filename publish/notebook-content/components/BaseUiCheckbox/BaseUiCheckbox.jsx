import { Checkbox } from '@base-ui/react/checkbox'

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={10}>
      <path d="M1 5l3 3L11 1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IndeterminateIcon() {
  return (
    <svg viewBox="0 0 12 2" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={2}>
      <path d="M1 1h10" strokeLinecap="round" />
    </svg>
  )
}

export default function BaseUiCheckbox({ label, indeterminate, ...props }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
      <Checkbox.Root
        indeterminate={indeterminate}
        {...props}
        className="
          flex items-center justify-center
          w-5 h-5 rounded border border-input bg-background
          text-white transition-colors
          hover:border-ring
          data-[checked]:bg-ring data-[checked]:border-ring
          data-[indeterminate]:bg-ring data-[indeterminate]:border-ring
          data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
          focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
        "
      >
        <Checkbox.Indicator className="flex data-[unchecked]:hidden">
          {indeterminate ? <IndeterminateIcon /> : <CheckIcon />}
        </Checkbox.Indicator>
      </Checkbox.Root>
      {label && <span>{label}</span>}
    </label>
  )
}
