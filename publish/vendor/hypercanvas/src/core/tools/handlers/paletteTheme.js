/**
 * Palette Theme tool — theme submenu for the command palette.
 *
 * Returns theme options as children, plus a "Theme settings" entry
 * that opens the toolbar Theme menu with the settings submenu expanded.
 */
export const id = 'palette-theme'

export async function handler() {
  const { getTheme, setTheme } = await import('../../index.js')
  const { getConfig } = await import('../../stores/configStore.js')

  return {
    getChildren() {
      const current = getTheme()
      const themes = (getConfig('theming') || {}).themes || {}
      return [
        // Theme options — driven by storyboard.config.json `theming.themes`
        ...Object.entries(themes).map(([themeId, def]) => ({
          id: `theme:${themeId}`,
          label: def?.label || themeId,
          type: 'toggle',
          active: current === themeId,
          execute: () => setTheme(themeId),
        })),
        // "Theme settings" opens the toolbar theme menu at the settings submenu
        {
          id: 'theme:settings',
          label: 'Theme settings',
          execute: () => {
            document.dispatchEvent(new CustomEvent('storyboard:open-theme-settings'))
          },
        },
      ]
    },
  }
}

