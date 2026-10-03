import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureTerminalAgentProfiles, ensureTerminalAgentCli } from '../canvas/terminal-agent-profiles.js'
import { writeTerminalContext, terminalContextPrompt } from '../canvas/terminal-context.js'
import { bindTerminalCodingTarget, initTerminalConfig, readTerminalConfigById, updateTerminalCodingContext } from '../canvas/terminal-config.js'
import { resolveTerminalCodingTargets, selectTerminalCodingTarget, validateBoundCodingTarget, writeCodingTargetPrompt } from '../canvas/terminal-coding-target.js'
import { getServerUrl } from './serverUrl.js'
import { resolveNotebookRoot } from './filesystemRoots.js'
import { captureFilePath, clearCaptureFile } from '../canvas/agent-session.js'

export async function saveCodingTargetPreference(config, selection) {
  const response = await fetch(`${getServerUrl()}/_storyboard/canvas/widget`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: config.canvasId, widgetId: config.widgetId, props: { codingTargetSiteId: selection } }),
    signal: AbortSignal.timeout(10_000),
  })
  const result = await response.json()
  if (!response.ok || result.error) throw new Error(result.error || 'Could not save coding target selection')
}

/** Runs in the Notebook PTY before the native agent starts. */
export async function prepareTerminalCodingLaunch(root, widgetId, { resume = false, assignment, choose, savePreference = saveCodingTargetPreference } = {}) {
  initTerminalConfig(root)
  ensureTerminalAgentProfiles(root)
  const config = readTerminalConfigById(widgetId)
  if (!config) throw new Error(`Terminal config missing for ${widgetId}`)
  let target
  if (resume) {
    // Legacy native sessions have no bound target: resume them in Notebook.
    target = validateBoundCodingTarget(config.lastAgentCodingTarget ?? null)
  } else {
    const candidates = resolveTerminalCodingTargets(root, config)
    let selection = config.widgetProps?.codingTargetSiteId
    if (selection == null && candidates.length > 1 && choose) {
      selection = await choose(candidates)
      if (selection === undefined) throw new Error('Coding target selection cancelled')
      await savePreference(config, selection)
    }
    target = selectTerminalCodingTarget(candidates, selection)
  }
  // Old SessionStart output must not associate a new target with the previous
  // native session before the new process has actually reported its ID.
  if (!resume) clearCaptureFile(captureFilePath(root, widgetId))
  let bound = bindTerminalCodingTarget(widgetId, target)
  if (!resume) bound = updateTerminalCodingContext(widgetId, () => ({ sessionAssignment: assignment ?? config.widgetProps?.initialPrompt ?? config.widgetProps?.prompt ?? null }))
  const binDirectory = ensureTerminalAgentCli(root)
  const promptFile = writeCodingTargetPrompt(root, bound, target, { includeAssignment: !resume })
  const context = writeTerminalContext(root, bound, { includeAssignment: !resume, targetState: 'available' })
  const launchId = randomUUID()
  return {
    target,
    promptFile,
    ...context,
    launchId,
    binDirectory,
    prompt: terminalContextPrompt(context, launchId, { resume, initial: true }) + ` Initial guidance file: ${JSON.stringify(promptFile)}.`,
  }
}

/** Local CLI uses the same canonical widget PATCH as canvas update. */
export async function handleCodingTarget() {
  try {
    const args = process.argv.slice(4)
    if (args.includes('--help')) {
      console.log('storyboard terminal coding-target [--site <id> | --notebook | --auto]\nShows candidates/bound target, or sets the current target for a running managed agent, or the next fresh launch.')
      return
    }
    const root = resolveNotebookRoot()
    initTerminalConfig(root)
    const config = readTerminalConfigById(process.env.STORYBOARD_WIDGET_ID)
    if (!config) throw new Error('STORYBOARD_WIDGET_ID must identify a managed terminal')
    const candidates = resolveTerminalCodingTargets(root, config)
    const index = args.indexOf('--site')
    const changes = Number(index >= 0) + Number(args.includes('--notebook')) + Number(args.includes('--auto'))
    if (changes > 1) throw new Error('Choose only one of --site, --notebook, or --auto')
    if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error('--site requires a Site ID')
    const selection = index >= 0 ? args[index + 1] : args.includes('--notebook') ? '' : null
    if (changes) {
      if (selection != null) selectTerminalCodingTarget(candidates, selection)
      await saveCodingTargetPreference(config, selection)
    }
    console.log(JSON.stringify({ candidates, selection: changes ? selection : config.widgetProps?.codingTargetSiteId ?? null, boundTarget: config.codingTarget ?? null, notebookRoot: root, configPath: join(root, '.storyboard', 'terminals', `${config.widgetId}.json`) }, null, 2))
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exitCode = 1
  }
}
