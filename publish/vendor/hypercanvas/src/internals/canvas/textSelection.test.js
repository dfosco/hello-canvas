import { shouldPreventCanvasTextSelection } from './textSelection.js'

describe('shouldPreventCanvasTextSelection', () => {
  it('prevents selection for regular canvas elements', () => {
    const container = document.createElement('div')
    const regular = document.createElement('p')
    container.appendChild(regular)

    expect(shouldPreventCanvasTextSelection(regular)).toBe(true)
  })

  it('allows selection for textarea editing', () => {
    const textarea = document.createElement('textarea')
    expect(shouldPreventCanvasTextSelection(textarea)).toBe(false)
  })

  it('allows selection for explicit editable markers', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-canvas-allow-text-selection', '')
    const child = document.createElement('span')
    wrapper.appendChild(child)

    expect(shouldPreventCanvasTextSelection(child)).toBe(false)
  })
})

