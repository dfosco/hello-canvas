/** Small browser-side event channel for Hypercanvas server events. */

let socket = null
let connecting = null
const listeners = new Map()
let connectionState = 'connecting'

function setConnectionState(state) {
  if (connectionState === state) return
  connectionState = state
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('storyboard:core-connection', { detail: { state } }))
  }
}

async function socketUrl() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL || '/'}_storyboard/ws-url`)
    const payload = await response.json()
    if (payload.url) return payload.url
  } catch { /* fall back to the same-origin proxy during startup */ }
  const base = new URL(import.meta.env.BASE_URL || '/', window.location.href)
  base.pathname = `${base.pathname.replace(/\/$/, '')}/_storyboard/ws`
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return base.toString()
}

function emit(message) {
  if (!message?.event) return
  for (const listener of listeners.get(message.event) || []) listener(message.data)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(message.event, { detail: message.data }))
}

function connect() {
  if (import.meta.env.MODE === 'test') return Promise.reject(new Error('WebSocket disabled in tests'))
  if (typeof WebSocket === 'undefined') return Promise.reject(new Error('WebSocket unavailable'))
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
  if (connecting) return connecting
  setConnectionState('connecting')
  connecting = new Promise((resolve, reject) => {
    void socketUrl().then((url) => {
      const next = new WebSocket(url)
      socket = next
      next.addEventListener('open', () => {
        connecting = null
        setConnectionState('connected')
        resolve(next)
      }, { once: true })
      next.addEventListener('message', (event) => {
        try { emit(JSON.parse(event.data)) } catch { /* ignore malformed server events */ }
      })
      next.addEventListener('close', () => {
        if (socket === next) socket = null
        connecting = null
        setConnectionState('disconnected')
        setTimeout(() => { if (listeners.size > 0) void connect().catch(() => {}) }, 500)
      })
      next.addEventListener('error', () => {
        setConnectionState('disconnected')
        if (connecting) reject(new Error('Hypercanvas WebSocket unavailable'))
      })
    }).catch((error) => {
      setConnectionState('disconnected')
      reject(error)
    })
  })
  return connecting
}

export const storyboardWs = {
  connectionState() { return connectionState },
  on(event, listener) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(listener)
    if ((import.meta.env.MODE === 'test' || typeof WebSocket === 'undefined') && import.meta.hot) import.meta.hot.on(event, listener)
    void connect().catch(() => {})
  },
  off(event, listener) {
    const set = listeners.get(event)
    if (!set) return
    set.delete(listener)
    if ((import.meta.env.MODE === 'test' || typeof WebSocket === 'undefined') && import.meta.hot?.off) import.meta.hot.off(event, listener)
    if (set.size === 0) listeners.delete(event)
  },
  send(event, data) {
    void connect().then((next) => next.send(JSON.stringify({ event, data }))).catch(() => {})
  },
}
