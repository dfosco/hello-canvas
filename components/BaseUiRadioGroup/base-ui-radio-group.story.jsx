import BaseUiRadioGroup from './BaseUiRadioGroup.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-center justify-center min-h-[220px] min-w-[280px] p-6 bg-card text-card-foreground">
      {children}
    </div>
  )
}

const plans = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
]

const billing = [
  { value: 'monthly', label: 'Monthly', description: 'Billed every 30 days' },
  { value: 'yearly', label: 'Yearly', description: 'Save 20% — billed annually' },
]

export function Default() {
  return <Frame><BaseUiRadioGroup defaultValue="pro" options={plans} /></Frame>
}

export function WithDescription() {
  return <Frame><BaseUiRadioGroup defaultValue="yearly" options={billing} /></Frame>
}

export function Disabled() {
  return <Frame><BaseUiRadioGroup defaultValue="pro" options={plans} disabled /></Frame>
}
