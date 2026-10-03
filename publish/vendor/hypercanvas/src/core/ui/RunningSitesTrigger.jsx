import { togglePanel } from '../stores/sidePanelStore.js'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import Icon from './Icon.jsx'

export default function RunningSitesTrigger({ config = {}, tabIndex }) {
  return (
    <TriggerButton
      size="icon-xl"
      aria-label={config.ariaLabel || 'Sites'}
      tabIndex={tabIndex}
      onClick={() => togglePanel('sites')}
    >
      <Icon name={config.icon || 'iconoir/globe'} size={16} />
    </TriggerButton>
  )
}
