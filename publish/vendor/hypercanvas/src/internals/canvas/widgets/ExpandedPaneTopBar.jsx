/**
 * ExpandedPaneTopBar — dark per-pane title bar for expanded/split-screen views.
 *
 * Each pane gets its own bar with a left-aligned label.
 * The rightmost (or only) pane shows the close button.
 *
 * Actions render as toolbar-style buttons (same as WidgetChrome) forced to dark mode.
 * Tooltips show labels on hover (Primer <Tooltip>, not title attr).
 *
 * Supports two action sources:
 *   1. `actions` array/function — legacy inline actions ({ icon, label, ariaLabel, onClick })
 *   2. `features` array — config-driven features resolved via ICON_REGISTRY
 *      Combined with `getState` for toggle resolution and `onAction` for dispatch.
 */
import { ScreenNormalIcon } from '@primer/octicons-react'
import Tooltip from '../../Tooltip.jsx'
import { ICON_REGISTRY } from './widgetIcons.jsx'
import { getWidgetMeta } from './widgetConfig.js'
import Icon from '../../Icon.jsx'
import styles from './ExpandedPaneTopBar.module.css'

/** Named icons use only lowercase alphanumeric, hyphens, and slashes. */
function isNamedIcon(str) {
  return str && /^[a-z0-9/-]+$/i.test(str)
}

/**
 * Resolve a feature's icon and label, applying toggle state if configured.
 * @param {Object} feature — config feature object
 * @param {((key: string) => any) | undefined} getState — state accessor
 * @returns {{ Icon: Function|null, label: string }}
 */
function resolveFeatureDisplay(feature, getState) {
  let Icon = ICON_REGISTRY[feature.icon]
  let label = feature.label || feature.action

  if (feature.toggle && getState) {
    const isActive = getState(feature.toggle.stateKey)
    if (isActive) {
      if (feature.toggle.activeIcon) Icon = ICON_REGISTRY[feature.toggle.activeIcon] || Icon
      if (feature.toggle.activeLabel) label = feature.toggle.activeLabel
    }
  }

  return { Icon, label }
}

/**
 * @param {Object} props
 * @param {string} props.label — pane display label
 * @param {string} [props.widgetType] — widget type string for icon resolution
 * @param {Object} [props.widgetProps] — widget props for contextual decorations (e.g. leader crown)
 * @param {boolean} [props.showClose] — show close button (rightmost pane)
 * @param {() => void} [props.onClose] — close entire ExpandedPane
 * @param {Array<{ label: string, onClick: () => void }>} [props.actions] — legacy action buttons
 * @param {Array} [props.features] — config-driven features for this surface
 * @param {(key: string) => any} [props.getState] — state accessor for toggle resolution
 * @param {(actionId: string) => void} [props.onAction] — action dispatch callback
 */
export default function ExpandedPaneTopBar({ label, widgetType, widgetProps, showClose, onClose, actions, features, getState, onAction }) {
  const resolvedActions = typeof actions === 'function' ? actions() : actions
  const meta = widgetType ? getWidgetMeta(widgetType) : null
  const iconName = meta?.icon || null
  const showLeaderCrown = widgetType === 'agent' && widgetProps?.role === 'leader'

  return (
    <div className={styles.bar}>
      {iconName && (
        <span className={styles.widgetIcon} aria-hidden="true">
          {isNamedIcon(iconName) ? <Icon name={iconName} size={12} /> : iconName}
        </span>
      )}
      <span className={styles.label}>{label}</span>
      {showLeaderCrown && (
        <span className={styles.leaderCrown} aria-label="Hub leader">
          <Icon name="iconoir/crown" size={12} color="#AE843B" />
        </span>
      )}

      {/* Config-driven feature actions */}
      {features?.map((feature) => {
        const { Icon, label: featureLabel } = resolveFeatureDisplay(feature, getState)
        return (
          <Tooltip key={feature.id} text={featureLabel} direction="s">
            <button
              className={styles.actionBtn}
              onClick={() => onAction?.(feature.action)}
              aria-label={featureLabel}
            >
              {Icon ? <Icon /> : featureLabel}
            </button>
          </Tooltip>
        )
      })}

      {/* Legacy inline actions (backward compat) */}
      {resolvedActions?.map((action, i) => (
        <Tooltip key={i} text={action.label || action.ariaLabel || 'Action'} direction="s">
          <button
            className={styles.actionBtn}
            onClick={action.onClick}
            aria-label={action.ariaLabel || action.label}
          >
            {action.icon || action.label}
          </button>
        </Tooltip>
      ))}

      {showClose && (
        <Tooltip text="Close fullscreen" direction="s">
          <button className={styles.actionBtn} onClick={onClose} aria-label="Close expanded view" autoFocus>
            <ScreenNormalIcon size={12} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
