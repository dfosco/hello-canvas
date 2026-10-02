import { NumberField } from '@base-ui/react/number-field'

export default function BaseUiNumberField({ label, ...props }) {
  return (
    <NumberField.Root {...props} className="flex flex-col gap-2 text-sm text-foreground">
      {label && <span className="font-medium">{label}</span>}
      <NumberField.Group className="
        inline-flex h-9 items-stretch overflow-hidden rounded-md border border-input bg-background
        focus-within:border-ring focus-within:ring-1 focus-within:ring-ring
      ">
        <NumberField.Decrement className="
          flex w-9 items-center justify-center text-muted-foreground
          border-r border-input bg-muted hover:bg-muted/70
          data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
        ">−</NumberField.Decrement>
        <NumberField.Input className="
          h-full w-20 bg-transparent px-2 text-center text-foreground
          outline-none [appearance:textfield]
          [&::-webkit-outer-spin-button]:appearance-none
          [&::-webkit-inner-spin-button]:appearance-none
        " />
        <NumberField.Increment className="
          flex w-9 items-center justify-center text-muted-foreground
          border-l border-input bg-muted hover:bg-muted/70
          data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
        ">+</NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  )
}
