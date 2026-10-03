const PASEO_CONNECTION_ENV_KEYS = Object.freeze([
  'PASEO_DAEMON_URL',
  'PASEO_DAEMON_PASSWORD',
  'PASEO_DAEMON_AUTH_HEADER',
])

const PRIVATE_CHILD_ENV_KEYS = new Set([
  ...PASEO_CONNECTION_ENV_KEYS,
  'HYPERCANVAS_LAUNCH_TOKEN',
  'HYPERCANVAS_PROXY_REGISTRATION_TOKEN',
  'PASEO_PASSWORD',
])

/** Copy an environment for a non-Core child process without runtime secrets. */
export function withoutRuntimeCredentials(environment = {}) {
  const childEnvironment = { ...environment }
  for (const key of PRIVATE_CHILD_ENV_KEYS) delete childEnvironment[key]
  return childEnvironment
}

/** Resolve daemon auth into the server-side Core process without mutating its parent. */
export function createPaseoServerEnvironment(environment = {}, connection = {}, ownership = {}) {
  const serverEnvironment = { ...environment }
  delete serverEnvironment.PASEO_PASSWORD

  const values = {
    PASEO_DAEMON_URL: connection.url,
    PASEO_DAEMON_PASSWORD: connection.password,
    PASEO_DAEMON_AUTH_HEADER: connection.authHeader,
  }
  for (const key of PASEO_CONNECTION_ENV_KEYS) {
    const value = values[key]
    if (typeof value === 'string' && value.length > 0) serverEnvironment[key] = value
    else delete serverEnvironment[key]
  }
  // When Core resolved a Paseo daemon itself, record whether it reused the
  // user's installed daemon or launched a private one so the runtime can tell
  // users which Paseo host contains their sessions.
  if (typeof ownership.owned === 'boolean') {
    serverEnvironment.HYPERCANVAS_PASEO_DAEMON_OWNED = ownership.owned ? '1' : '0'
  }
  if (typeof ownership.usePaseoApp === 'boolean') {
    serverEnvironment.HYPERCANVAS_PASEO_USE_APP = ownership.usePaseoApp ? '1' : '0'
  }
  if (ownership.reuseProbeFailure) serverEnvironment.HYPERCANVAS_PASEO_REUSE_FAILURE = ownership.reuseProbeFailure
  else delete serverEnvironment.HYPERCANVAS_PASEO_REUSE_FAILURE
  return serverEnvironment
}
