/**
 * Hide/Show toolbars tool — command palette only.
 *
 * Toggles the `storyboard-chrome-hidden` class (same as Cmd+.).
 * Label flips between "Hide toolbars" and "Show toolbars" based on state.
 */
export const id = 'hide-toolbars'

export async function handler() {
  return {
    getChildren() {
      const hidden = document.documentElement.classList.contains('storyboard-chrome-hidden')
      return [{
        id: 'core/toggle-toolbars',
        label: hidden ? 'Show toolbars' : 'Hide toolbars',
        type: 'default',
        execute: () => {
          const isHidden = document.documentElement.classList.contains('storyboard-chrome-hidden')
          document.documentElement.classList.toggle('storyboard-chrome-hidden', !isHidden)
          document.documentElement.classList.remove('storyboard-chrome-completely-hidden')
        },
      }]
    },
  }
}
