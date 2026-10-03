import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { FormContext } from './FormContext.js'

describe('FormContext', () => {
  it('is a React context object', () => {
    expect(FormContext).toBeDefined()
    expect(FormContext.Provider).toBeDefined()
    expect(FormContext.Consumer).toBeDefined()
  })

  it('has a default value of null', () => {
    function Reader() {
      return createElement(FormContext.Consumer, null, (value) =>
        createElement('span', { 'data-testid': 'val' }, String(value)),
      )
    }
    render(createElement(Reader))
    expect(screen.getByTestId('val')).toHaveTextContent('null')
  })

  it('can provide and consume a value with prefix, getDraft, setDraft', () => {
    const getDraft = vi.fn((name) => `draft-${name}`)
    const setDraft = vi.fn()
    const contextValue = { prefix: 'checkout', getDraft, setDraft }

    function Reader() {
      return createElement(FormContext.Consumer, null, (value) =>
        createElement(
          'span',
          { 'data-testid': 'val' },
          `${value.prefix}:${value.getDraft('email')}`,
        ),
      )
    }

    render(
      createElement(
        FormContext.Provider,
        { value: contextValue },
        createElement(Reader),
      ),
    )

    expect(screen.getByTestId('val')).toHaveTextContent('checkout:draft-email')
    expect(getDraft).toHaveBeenCalledWith('email')
  })
})
