import { handler as createDevtoolsHandler } from './devtools.js'

function getProdModeItem(children) {
  return children.find(item => item.id === 'core/prod-mode')
}

function getCanvasAutoReloadItem(children) {
  return children.find(item => item.id === 'core/canvas-auto-reload')
}

function getPrototypeAutoReloadItem(children) {
  return children.find(item => item.id === 'core/prototype-auto-reload')
}

describe('devtools production mode toggle', () => {
  const originalLocalDev = window.__SB_LOCAL_DEV__

  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    delete window.__SB_LOCAL_DEV__
  })

  afterAll(() => {
    if (typeof originalLocalDev === 'undefined') delete window.__SB_LOCAL_DEV__
    else window.__SB_LOCAL_DEV__ = originalLocalDev
  })

  it('shows the toggle in local dev', async () => {
    window.__SB_LOCAL_DEV__ = true

    const devtools = await createDevtoolsHandler({})
    const prodModeItem = getProdModeItem(devtools.getChildren())

    expect(prodModeItem).toBeTruthy()
    expect(prodModeItem.active).toBe(false)
  })

  it('shows the toggle as active in local-dev prodMode simulation', async () => {
    window.__SB_LOCAL_DEV__ = true
    window.history.replaceState({}, '', '/?prodMode')

    const devtools = await createDevtoolsHandler({})
    const prodModeItem = getProdModeItem(devtools.getChildren())

    expect(prodModeItem).toBeTruthy()
    expect(prodModeItem.active).toBe(true)
  })

  it('hides the toggle in true production mode', async () => {
    window.__SB_LOCAL_DEV__ = false

    const devtools = await createDevtoolsHandler({})
    const prodModeItem = getProdModeItem(devtools.getChildren())

    expect(prodModeItem).toBeUndefined()
  })
})

describe('devtools canvas auto-reload toggle', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('shows the toggle as inactive by default (guard ON)', async () => {
    const devtools = await createDevtoolsHandler({})
    const item = getCanvasAutoReloadItem(devtools.getChildren())

    expect(item).toBeTruthy()
    expect(item.type).toBe('toggle')
    expect(item.active).toBe(false)
  })
})

describe('devtools prototype auto-reload toggle', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('shows the toggle as inactive by default (guard ON, auto-reload OFF)', async () => {
    const devtools = await createDevtoolsHandler({})
    const item = getPrototypeAutoReloadItem(devtools.getChildren())

    expect(item).toBeTruthy()
    expect(item.type).toBe('toggle')
    expect(item.active).toBe(false)
  })
})
