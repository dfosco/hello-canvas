import { Progress } from '@base-ui/react/progress'

export default function BaseUiProgress({ label, value = null, ...props }) {
  return (
    <Progress.Root value={value} {...props} className="flex w-full flex-col gap-2 text-sm text-foreground">
      <div className="flex items-baseline justify-between">
        {label && <Progress.Label className="font-medium">{label}</Progress.Label>}
        <Progress.Value className="font-mono text-xs text-muted-foreground" />
      </div>
      <Progress.Track className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <Progress.Indicator
          className="
            h-full rounded-full bg-ring transition-[width] duration-300
            data-[indeterminate]:w-1/3 data-[indeterminate]:animate-pulse
          "
        />
      </Progress.Track>
    </Progress.Root>
  )
}
