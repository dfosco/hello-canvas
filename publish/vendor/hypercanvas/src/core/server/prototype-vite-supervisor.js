import { spawn } from 'node:child_process'

const DEFAULT_BACKOFF_MS = [100, 500, 2000]

function asPromise(value) {
  return value && typeof value.then === 'function' ? value : Promise.resolve(value)
}

/**
 * Owns one prototype Vite child without making the parent service depend on it.
 * The probe should return a truthy value once the child is serving its URL.
 */
export function createPrototypeViteSupervisor({
  command,
  args = [],
  cwd,
  env,
  url,
  probe,
  spawnProcess = spawn,
  timers = globalThis,
  readinessIntervalMs = 100,
  maxRestarts = 3,
  restartBackoffMs = DEFAULT_BACKOFF_MS,
  onReady = () => {},
  onRestart = () => {},
  onError = () => {},
} = {}) {
  if (typeof command !== 'string' || !command) throw new TypeError('command is required')
  if (typeof probe !== 'function') throw new TypeError('probe is required')

  let child = null
  let ready = false
  let closed = false
  let restartCount = 0
  let restartTimer = null
  let readinessTimer = null
  let startPromise = null

  function clearTimer(timer) {
    if (timer !== null) timers.clearTimeout(timer)
  }

  function clearPendingWork() {
    clearTimer(restartTimer)
    clearTimer(readinessTimer)
    restartTimer = null
    readinessTimer = null
  }

  function reportError(error) {
    onError(error)
  }

  function scheduleReadinessProbe() {
    if (closed || !child || ready || readinessTimer !== null) return
    readinessTimer = timers.setTimeout(() => {
      readinessTimer = null
      void checkReadiness()
    }, readinessIntervalMs)
    readinessTimer?.unref?.()
  }

  async function checkReadiness() {
    if (closed || !child || ready) return
    try {
      if (await probe(url)) {
        ready = true
        onReady(url)
        return
      }
    } catch (error) {
      reportError(error)
    }
    scheduleReadinessProbe()
  }

  function scheduleRestart() {
    if (closed || restartTimer !== null || restartCount >= maxRestarts) return
    const delay = restartBackoffMs[Math.min(restartCount, restartBackoffMs.length - 1)] ?? 0
    restartCount += 1
    onRestart({ attempt: restartCount, delay })
    restartTimer = timers.setTimeout(() => {
      restartTimer = null
      void startChild()
    }, delay)
    restartTimer?.unref?.()
  }

  function handleExit(exitedChild) {
    if (child !== exitedChild) return
    child = null
    ready = false
    clearTimer(readinessTimer)
    readinessTimer = null
    scheduleRestart()
  }

  async function startChild() {
    if (closed || child) return
    try {
      const nextChild = spawnProcess(command, args, {
        cwd,
        env: env ? { ...process.env, ...env } : undefined,
        stdio: 'pipe',
      })
      child = nextChild
      nextChild.once('exit', () => handleExit(nextChild))
      nextChild.once('error', reportError)
      await checkReadiness()
    } catch (error) {
      reportError(error)
      scheduleRestart()
    }
  }

  function start() {
    if (!startPromise) {
      startPromise = asPromise(startChild()).then(() => supervisor)
    }
    return startPromise
  }

  async function close() {
    if (closed) return
    closed = true
    clearPendingWork()
    ready = false
    const currentChild = child
    child = null
    if (!currentChild || currentChild.killed) return
    currentChild.removeAllListeners('exit')
    currentChild.removeListener('error', reportError)
    await asPromise(currentChild.kill())
  }

  const supervisor = {
    start,
    close,
    get child() { return child },
    get ready() { return ready },
    get restartCount() { return restartCount },
    get closed() { return closed },
  }
  return supervisor
}
