/**
 * Tooltip — internal adapter that exposes the Primer-style
 * `<Tooltip text direction>{trigger}</Tooltip>` API on top of the
 * framework-neutral core Tooltip primitive (`core/lib/components/ui/tooltip`).
 *
 * Lets canvas chrome and the viewfinder use a tooltip without pulling in
 * `@primer/react` — see plan `.github/plans/style-separation.md` (Layer A).
 *
 * Direction mapping (Primer → base-ui):
 *   n  → top                ne → top    + align=end
 *   s  → bottom             nw → top    + align=start
 *   e  → right              se → bottom + align=end
 *   w  → left               sw → bottom + align=start
 *
 * The trigger child renders via `asChild`, preserving its original element
 * (typically a `<button>`) so click semantics and accessibility are unchanged.
 */
import * as Tooltip from '../core/lib/components/ui/tooltip/index.js'

const DIRECTION_MAP = {
  n:  { side: 'top',    align: 'center' },
  s:  { side: 'bottom', align: 'center' },
  e:  { side: 'right',  align: 'center' },
  w:  { side: 'left',   align: 'center' },
  ne: { side: 'top',    align: 'end' },
  nw: { side: 'top',    align: 'start' },
  se: { side: 'bottom', align: 'end' },
  sw: { side: 'bottom', align: 'start' },
}

export default function TooltipAdapter({ text, direction = 'n', children, ...rest }) {
  const { side, align } = DIRECTION_MAP[direction] || DIRECTION_MAP.n
  return (
    <Tooltip.Root {...rest}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Content side={side} align={align}>{text}</Tooltip.Content>
    </Tooltip.Root>
  )
}
