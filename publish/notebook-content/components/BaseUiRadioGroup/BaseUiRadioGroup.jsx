import { RadioGroup } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'

export default function BaseUiRadioGroup({ options = [], ...props }) {
  return (
    <RadioGroup {...props} className="flex flex-col gap-3">
      {options.map((opt) => (
        <label
          key={opt.value}
          className="inline-flex items-start gap-3 text-sm text-foreground cursor-pointer select-none data-[disabled]:opacity-50"
        >
          <Radio.Root
            value={opt.value}
            disabled={opt.disabled || props.disabled}
            className="
              mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center
              rounded-full border border-input bg-background transition-colors
              hover:border-ring
              data-[checked]:border-ring
              data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
              focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
            "
          >
            <Radio.Indicator className="h-2.5 w-2.5 rounded-full bg-ring data-[unchecked]:hidden" />
          </Radio.Root>
          <span className="flex flex-col">
            <span className="font-medium">{opt.label}</span>
            {opt.description && (
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            )}
          </span>
        </label>
      ))}
    </RadioGroup>
  )
}
