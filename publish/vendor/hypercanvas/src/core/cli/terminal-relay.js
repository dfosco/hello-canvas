/** Attach the local TTY to an existing Storyboard terminal WebSocket. */

export async function openTerminalRelay({ serverUrl, session }) {
  const WebSocket = globalThis.WebSocket || (await import('ws')).WebSocket
  const query = new URLSearchParams({
    canvas: session.canvasId || 'unknown',
    name: session.name || '',
  })
  const endpoint = new URL(`${serverUrl.replace(/\/$/, '')}/_storyboard/terminal/${encodeURIComponent(session.widgetId)}?${query}`)
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = endpoint.toString()
  const socket = new WebSocket(url)
  const stdin = process.stdin
  const stdout = process.stdout
  const wasRaw = stdin.isRaw

  return new Promise((resolve, reject) => {
    const resize = () => {
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({
        type: 'resize',
        cols: stdout.columns || 80,
        rows: stdout.rows || 24,
      }))
    }
    const input = (data) => {
      const bytes = Buffer.from(data)
      if (bytes.length === 1 && bytes[0] === 0x1d) {
        socket.close()
        return
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(data)
    }
    const restore = () => {
      process.off('SIGWINCH', resize)
      stdin.off('data', input)
      if (stdin.isTTY) stdin.setRawMode(Boolean(wasRaw))
      stdin.pause()
    }

    socket.addEventListener('open', () => {
      stdout.write('\r\n[Ctrl+] detach]\r\n')
      if (stdin.isTTY) stdin.setRawMode(true)
      stdin.resume()
      stdin.on('data', input)
      process.on('SIGWINCH', resize)
      resize()
    })
    socket.addEventListener('message', (event) => {
      const data = event.data
      if (typeof data === 'string') stdout.write(data)
      else if (data instanceof ArrayBuffer) stdout.write(Buffer.from(data))
      else stdout.write(Buffer.from(data))
    })
    socket.addEventListener('error', (event) => {
      restore()
      reject(event.error || new Error(`Terminal connection failed: ${url}`))
    })
    socket.addEventListener('close', () => {
      restore()
      resolve()
    })
  })
}
