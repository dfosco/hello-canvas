import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import Icon from './Icon.jsx'
import { openNotebookSidebar } from '../notebook/browserBridge.js'

export default function RunningSitesTrigger({ config = {}, tabIndex }) {
  return (
    <TriggerButton
      size="icon-xl"
      aria-label={config.ariaLabel || 'Sites'}
      tabIndex={tabIndex}
      onClick={() => openNotebookSidebar({ focusType: 'site' })}
    >
      <Icon name={config.icon || 'iconoir/globe'} size={16} />
    </TriggerButton>
  )
}
