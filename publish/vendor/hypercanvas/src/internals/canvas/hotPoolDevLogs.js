/**
 * Hot Pool browser devlogs — listens for server HMR events and
 * logs them to the browser console when DevTools "Dev logs" is on.
 */

import { getFlag } from '../../core/index.js'
import { storyboardWs } from '../storyboard-ws.js'

let registered = false

function isDevLogsEnabled() {
  return getFlag('dev-logs')
}

export function registerHotPoolDevLogs() {
  if (registered) return
  registered = true

  storyboardWs.on('storyboard:hot-pool-log', (data) => {
    if (!isDevLogsEnabled()) return
    const poolTag = data.poolId ? `:${data.poolId}` : ''
    console.log(`%c[hot-pool${poolTag}]%c ${data.message}`, 'color: #8b5cf6; font-weight: bold', 'color: inherit')
  })
}
