import { realpathSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SiteStore, assertExternalSiteRoot } from '../site/site.js'
import { quoteShellWord } from '../host-tools/runtime.js'
import { buildHubBootstrapPrompt } from './terminal-config.js'

/** Read-only resolution: Site bindings, not Frame props, own filesystem roots. */
export function resolveTerminalCodingTargets(root, config, store = new SiteStore(root)) {
  const sites = new Map()
  for (const widget of config?.connectedWidgets || []) {
    if (widget?.type !== 'site-frame' || !widget.props?.siteId) continue
    const siteId = widget.props.siteId
    if (!sites.has(siteId)) sites.set(siteId, { siteId, frames: [] })
    sites.get(siteId).frames.push({ widgetId: widget.id, route: widget.props.route || '' })
  }
  return [...sites.values()].map(candidate => {
    try {
      const descriptor = store.get(candidate.siteId)
      if (!descriptor) throw new Error('Site is no longer registered in this Notebook')
      const binding = store.getBinding(candidate.siteId)
      if (!binding?.root) throw new Error('Site has no local source directory (URL-only or missing binding)')
      const directory = assertExternalSiteRoot(root, binding.root)
      if (!statSync(directory).isDirectory()) throw new Error('Site source is not a directory')
      return { ...candidate, title: descriptor.title || candidate.siteId, root: directory, error: null }
    } catch (error) {
      return { ...candidate, title: candidate.siteId, root: null, error: error.message }
    }
  })
}

export function selectTerminalCodingTarget(candidates, selection) {
  if (selection === '') return null // explicit Notebook preference
  if (selection != null) {
    const target = candidates.find(candidate => candidate.siteId === selection)
    if (!target) throw new Error(`Selected Site ${selection} is not connected. Choose a connected coding target.`)
    if (target.error) throw new Error(`${target.title}: ${target.error}`)
    return target
  }
  if (!candidates.length) return null
  if (candidates.length > 1) {
    const error = new Error('Several Sites are connected. Choose a coding target before further source edits.')
    error.code = 'CODING_TARGET_REQUIRED'
    throw error
  }
  if (candidates[0].error) throw new Error(`${candidates[0].title}: ${candidates[0].error}`)
  return candidates[0]
}

/** A resume must not resolve current bindings, even if the Site moved. */
export function validateBoundCodingTarget(target) {
  if (!target) return null
  try {
    if (!target.root || !statSync(target.root).isDirectory() || realpathSync.native(target.root) !== target.root) throw new Error('missing or replaced directory')
  } catch {
    throw new Error(`Bound coding target ${target.title || target.siteId} is unavailable at ${target.root}. Restore it or start a new session with a new target.`)
  }
  return target
}

export function codingTargetBootstrap(root, config, target, { includeAssignment = true } = {}) {
  const parts = [
    `Notebook context root: ${JSON.stringify(root)}.`,
    `Before starting, read ${JSON.stringify(join(root, '.agents', 'terminal-agent.agent.md'))} when it exists.`,
    `Read your live widget config at ${JSON.stringify(join(root, '.storyboard', 'terminals', `${config.widgetId}.json`))}.`,
  ]
  if (target) parts.push(
    `Current coding target: ${JSON.stringify(target.root)} (Site ${JSON.stringify(target.siteId)}). Explicit Site connections or target choices can update it; filesystem rebinding alone cannot. Read the current codingTarget in your live config before each new coding task.`,
    `Before editing, read the target repository's applicable AGENTS.md, CLAUDE.md, or other native repository instructions, including instructions for the files you edit.`,
    'Use absolute target paths for edits and searches. Run build/test commands with the coding target as working directory; use git -C with that directory for repository operations. Follow target repository conventions for coding, testing, and Git; Notebook instructions govern canvas context and coordination.',
    'A shell cd changes only that shell; it does not change the base directory of every agent tool. Explicitly target every coding operation. This is instruction-based routing, not a write sandbox.',
    `Notebook state, initial prompts, selected widgets, skills, agent guidance, and assets remain under ${JSON.stringify(root)}. Read them there using absolute paths. Use the Notebook's storyboard CLI/server for canvas, inbox, output, and status operations. Do not install or copy configuration into the Site.`,
    `Target Site Frames: ${JSON.stringify(target.frames || [])}.`,
  )
  const assignment = config.widgetProps?.initialPrompt || config.widgetProps?.prompt
  if (includeAssignment && assignment) parts.push(assignment)
  const hub = buildHubBootstrapPrompt(config, config.widgetId)
  if (hub) parts.push(hub)
  return parts.join('\n\n')
}

export function writeCodingTargetPrompt(root, config, target, options) {
  const file = join(root, '.storyboard', 'terminals', `${config.widgetId}.initial-prompt.md`)
  writeFileSync(file, `${codingTargetBootstrap(root, config, target, options)}\n`)
  return file
}

/** Native interactive startup prompts; never interpolate unquoted context. */
export function appendTerminalAgentPrompt(command, agentId, prompt) {
  if (!command || !prompt) return command
  const option = agentId === 'copilot' ? ' --interactive ' : agentId === 'opencode' ? ' --prompt ' : ' '
  return `${command}${option}${quoteShellWord(prompt)}`
}

/** Batch commands cannot receive later interactive PTY messages. */
export function isInteractiveTerminalAgent(command, agentId) {
  const flags = { codex: /\bexec\b/, claude: /(?:^|\s)(?:-p|--print)(?:\s|=|$)/, copilot: /(?:^|\s)(?:-p|--prompt)(?:\s|=|$)/, opencode: /\brun\b/, pi: /(?:^|\s)(?:-p|--print)(?:\s|=|$)/ }
  return !flags[agentId]?.test(command || '')
}
