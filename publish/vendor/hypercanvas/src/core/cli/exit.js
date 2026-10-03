/**
 * storyboard exit — Stop every dev server tracked in the registry.
 *
 * No daemon, no proxy — just SIGTERM every PID in
 * `.storyboard/servers.json` and clear their entries.
 */

import * as p from '@clack/prompts'
import { list, unregister } from '../worktree/serverRegistry.js'

p.intro('storyboard exit')

const servers = list()
if (servers.length === 0) {
  p.log.info('No dev servers running.')
} else {
  let stopped = 0
  for (const s of servers) {
    try {
      process.kill(s.pid, 'SIGTERM')
      stopped++
    } catch { /* already dead */ }
    unregister(s.id)
  }
  p.log.success(`Stopped ${stopped} dev server${stopped !== 1 ? 's' : ''}.`)
}

p.outro('')
