#!/usr/bin/env node
import { requestTerminalContext } from './terminal-context.js'
/**
 * storyboard terminal-welcome — interactive welcome prompt for new terminal sessions.
 *
 * Runs inside the broker-managed PTY, presents a Clack select prompt, and loops after
 * the chosen program exits.
 *
 * When called with --startup <cmd>, auto-launches that command on the first
 * iteration, then falls back to the interactive menu on subsequent iterations
 * (i.e. when the command exits). This makes the welcome screen the universal
 * supervisor for all terminal widget sessions.
 *
 * Usage (called automatically by terminal-server for new sessions):
 *   storyboard terminal-welcome [--branch <name>] [--canvas <name>]
 *   storyboard terminal-welcome --startup "copilot --agent terminal-agent" [--branch <name>] [--canvas <name>]
 */

import * as p from '@clack/prompts'
import { execFileSync, execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { parseFlags } from './flags.js'
import { dim, bold } from './intro.js'
import { readAgentsConfig } from '../canvas/configReader.js'
import { resolveApplicationRoot, resolveNotebookRoot } from './filesystemRoots.js'
import { requestAgentActivation } from './terminal-messaging.js'
import { prepareTerminalCodingLaunch, saveCodingTargetPreference } from './terminal-coding-target.js'
import { initTerminalConfig, readTerminalConfigById, updateTerminalCodingContext } from '../canvas/terminal-config.js'
import { appendTerminalAgentPrompt, isInteractiveTerminalAgent, resolveTerminalCodingTargets, selectTerminalCodingTarget } from '../canvas/terminal-coding-target.js'
import { buildResumeStartupCommand } from '../canvas/agent-session.js'
import { getAgentDefinition } from '../host-tools/catalog.js'
import {
  buildHostWorkloadEnv,
  reassertHostPath,
  resolveAgentHostRuntime,
  resolveTerminalHostRuntime,
  rewriteAgentCommand,
} from '../host-tools/runtime.js'

const blue = (s) => `\x1b[34m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

/**
 * Drain any pending bytes from stdin to prevent stale mouse escape sequences
 * (or other buffered input) from being consumed by Clack prompts.
 * Browser mouse events can arrive as escape sequences on stdin.
 */
function drainStdin() {
  if (!process.stdin.readable) return
  const wasPaused = process.stdin.isPaused?.()
  try {
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    // Read and discard all buffered data
    while (process.stdin.read() !== null) { /* discard */ }
  } catch { /* best effort */ }
  if (wasPaused) {
    try { process.stdin.pause() } catch { /* empty */ }
  }
}

const projectRoot = resolveNotebookRoot()
const terminalRuntime = resolveTerminalHostRuntime(projectRoot)
const storyboardCliPath = isAbsolute(process.argv[1] || '') && existsSync(process.argv[1])
  ? resolve(process.argv[1])
  : null

function sessionEnvironment(runtime) {
  const env = buildHostWorkloadEnv(runtime, {
    STORYBOARD_WIDGET_ID: process.env.STORYBOARD_WIDGET_ID || '',
    STORYBOARD_CANVAS_ID: process.env.STORYBOARD_CANVAS_ID || '',
    STORYBOARD_BRANCH: process.env.STORYBOARD_BRANCH || '',
    STORYBOARD_SERVER_URL: process.env.STORYBOARD_SERVER_URL || '',
    STORYBOARD_PROJECT_ROOT: projectRoot,
    TERM_PROGRAM: 'storyboard',
  })
  env.FORCE_COLOR = '3'
  env.COLORTERM = 'truecolor'
  env.TERM = 'xterm-256color'
  const localBin = join(projectRoot, '.storyboard', 'terminals', 'bin')
  env.PATH = [localBin, env.PATH].filter(Boolean).join(':')
  return env
}

/**
 * Resolve the configured executable before starting a login shell. Login
 * profiles can reorder PATH (for example, selecting an older Homebrew Codex
 * ahead of a newer user-local install), so leaving the bare command to zsh
 * can launch a different runtime than the server detected.
 */
function resolveStartupCommand(command, env) {
  const match = String(command || '').match(/^(\S+)([\s\S]*)$/)
  if (!match || match[1].startsWith('/')) return command
  try {
    const resolved = execFileSync('which', [match[1]], { env, encoding: 'utf8' }).trim().split('\n').pop()
    if (resolved?.startsWith('/')) return `${resolved}${match[2]}`
  } catch { /* let the login shell report the normal command-not-found error */ }
  return command
}

/**
 * Read agents config (lib defaults + storyboard.config.json + terminal.config.json merged).
 * Returns an array of { id, label, startupCommand, resumeCommand } entries.
 */
function loadAgents() {
  try {
    const agents = readAgentsConfig(projectRoot, resolveApplicationRoot())
    if (!agents || typeof agents !== 'object') return []
    return Object.entries(agents).filter(([id]) => getAgentDefinition(id)).map(([id, cfg]) => ({
      ...cfg,
      id,
      label: cfg.label || id,
      startupCommand: cfg.startupCommand || null,
      resumeCommand: cfg.resumeCommand || null,
      readinessSignal: cfg.readinessSignal || null,
      postStartup: cfg.postStartup || null,
    })).filter(a => a.startupCommand)
  } catch { return [] }
}

const agents = loadAgents()

const flagSchema = {
  branch: { type: 'string', description: 'Current branch name' },
  canvas: { type: 'string', description: 'Current canvas name' },
  name: { type: 'string', description: 'Terminal pretty name' },
  startup: { type: 'string', description: 'Auto-launch this command on first iteration' },
  agent: { type: 'string', description: 'Configured agent ID for an auto-launched command' },
  'resume-session': { type: 'string', description: 'Resume this widget native session, retaining its bound coding target' },
}

const { flags } = parseFlags(process.argv.slice(3), flagSchema)
const branch = flags.branch || 'unknown'
const canvas = flags.canvas || 'unknown'
const prettyName = flags.name || null
const canvasShort = canvas === 'unknown' ? canvas : canvas.split('/').pop()
const startupCmd = flags.startup || null
const startupAgentId = flags.agent || null
const resumeSessionId = flags['resume-session'] || null

async function chooseCodingTarget(candidates) {
  drainStdin()
  const selected = await p.select({
    message: 'Where should the agent write code?',
    options: [
      ...candidates.map(target => ({ value: target.siteId, label: `${target.title} — ${target.root || target.error}` })),
      { value: '', label: `Notebook — ${projectRoot}` },
    ],
  })
  if (p.isCancel(selected)) return undefined
  selectTerminalCodingTarget(candidates, selected)
  return selected
}

async function configureCodingTarget() {
  initTerminalConfig(projectRoot)
  const config = readTerminalConfigById(process.env.STORYBOARD_WIDGET_ID)
  if (!config) throw new Error('Terminal widget context is unavailable')
  const candidates = resolveTerminalCodingTargets(projectRoot, config)
  drainStdin()
  const selected = await p.select({
    message: 'Coding target for the next new agent session',
    options: [
      { value: '@automatic', label: 'Automatic from connected Site Frames' },
      { value: '', label: `Notebook — ${projectRoot}` },
      ...candidates.map(target => ({ value: target.siteId, label: `${target.title} — ${target.root || target.error}` })),
    ],
  })
  if (p.isCancel(selected)) return
  const preference = selected === '@automatic' ? null : selected
  if (preference != null) selectTerminalCodingTarget(candidates, preference)
  await saveCodingTargetPreference(config, preference)
  p.log.info('Saved for the next new agent session. Resumed sessions retain their original target.')
}

/**
 * Reset terminal state after a child process exits.
 * Children (especially TUI apps) may leave the terminal in raw mode,
 * alternate screen, or with the cursor hidden.
 */
function resetTerminal() {
  // Leave alternate screen, show cursor, reset attributes
  process.stdout.write('\x1b[?1049l\x1b[?25h\x1b[0m')
  try { execSync('stty sane 2>/dev/null', { stdio: 'ignore' }) } catch { /* empty */ }
}

/**
 * Spawn an interactive shell with the storyboard bin dir on PATH.
 */
function spawnShell() {
  const child = spawn(terminalRuntime.shell, [], {
    stdio: 'inherit',
    cwd: terminalRuntime.cwd,
    env: sessionEnvironment(terminalRuntime),
  })

  return new Promise((resolve) => {
    child.on('close', resolve)
    child.on('error', resolve)
  })
}

/**
 * Launch an agent by spawning its startupCommand via the user's shell.
 * @param {Object} agent - Agent config with label, startupCommand, readinessSignal, postStartup
 */
async function launchAgent(agent, { activate = true, resume = false, sessionId = null } = {}) {
  // Show metadata after selection
  const meta = [
    prettyName ? `${dim('name:')} ${blue(prettyName)}` : null,
    `${dim('branch:')} ${blue(branch)}`,
    `${dim('canvas:')} ${blue(canvasShort)}`,
  ].filter(Boolean).join('  ')
  p.log.info(meta)
  p.outro(dim(`Starting ${agent.label}...`))
  let exitCode = null
  const startTime = Date.now()
  let codingContext = null

  try {
    const runtime = agent.id ? await resolveAgentHostRuntime(projectRoot, agent.id) : terminalRuntime
    const context = agent.id && process.env.STORYBOARD_WIDGET_ID
      ? await prepareTerminalCodingLaunch(projectRoot, process.env.STORYBOARD_WIDGET_ID, { resume, choose: chooseCodingTarget })
      : null
    codingContext = context
    if (context) await requestTerminalContext({ widgetId: process.env.STORYBOARD_WIDGET_ID, action: 'start', launchId: context.launchId, revision: context.revision, interactive: isInteractiveTerminalAgent(agent.startupCommand, agent.id) })
    if (activate && agent.id) await requestAgentActivation(agent.id)
    const startup = appendTerminalAgentPrompt(agent.startupCommand, agent.id, context?.prompt)
    const launch = sessionId
      ? buildResumeStartupCommand({ startupCommand: startup, sessionId, agentCfg: {
        ...agent,
        resumeCommand: appendTerminalAgentPrompt(agent.resumeCommand, agent.id, context?.prompt),
        // A global "last" session can belong to a different coding target.
        resumeLastCommand: context?.target ? null : agent.resumeLastCommand,
      } })
      : startup
    const configuredCommand = agent.id ? rewriteAgentCommand(runtime, launch) : launch
    // -ilc: interactive + login so both .zprofile and .zshrc are sourced.
    // Many users install agent CLIs (claude, copilot, etc.) via nvm/volta/asdf
    // shims that only register PATH in .zshrc. Without -i the binary is not found.
    const env = sessionEnvironment(runtime)
    if (context) env.STORYBOARD_CONTEXT_LAUNCH_ID = context.launchId
    const command = reassertHostPath(runtime, configuredCommand)
    const startupCommand = resolveStartupCommand(command, env)
    const child = spawn(runtime.shell, ['-ilc', startupCommand], {
      stdio: 'inherit',
      cwd: runtime.cwd,
      env,
    })
    exitCode = await new Promise((resolve) => {
      child.on('close', resolve)
      child.on('error', () => resolve(1))
    })
  } catch (error) {
    p.log.error(error?.message || `Failed to start ${agent.label}. Is it installed?`)
    await new Promise(r => setTimeout(r, 2000))
    exitCode = 1
  } finally {
    if (codingContext) {
      initTerminalConfig(projectRoot)
      updateTerminalCodingContext(process.env.STORYBOARD_WIDGET_ID, current => current.contextState?.launchId === codingContext.launchId ? { contextState: { ...current.contextState, phase: 'stopped' } } : {})
      await requestTerminalContext({ widgetId: process.env.STORYBOARD_WIDGET_ID, action: 'exit', launchId: codingContext.launchId }).catch(() => {})
    }
    // Drain input before Clack resumes so buffered mouse sequences cannot
    // auto-select menu options in a tight loop.
    await new Promise(r => setTimeout(r, 50))
    drainStdin()
  }

  const durationMs = Date.now() - startTime
  return { exitCode, durationMs }
}

async function welcomeLoop() {
  let firstIteration = true
  const MAX_STARTUP_RETRIES = 2

  while (true) {
    // On first iteration with --startup, auto-launch the command
    if (firstIteration && startupCmd) {
      firstIteration = false

      if (startupCmd === 'shell') {
        // Plain shell — spawn interactive shell, return to welcome on exit
        try { await spawnShell() } catch { /* empty */ }
        resetTerminal()
        continue
      }

      const matchedAgent = agents.find((agent) => agent.id === startupAgentId)
      if (startupAgentId && !matchedAgent) {
        p.log.error(`Agent ${startupAgentId} is not configured.`)
        await new Promise(r => setTimeout(r, 2000))
        continue
      }
      const agent = matchedAgent
        ? { ...matchedAgent, startupCommand: startupCmd }
        : { id: null, label: startupCmd.trim().match(/^[^\s]+/)?.[0] || 'command', startupCommand: startupCmd }

      let succeeded = false
      for (let attempt = 0; attempt < MAX_STARTUP_RETRIES; attempt++) {
        const result = await launchAgent(agent, { activate: false, resume: Boolean(resumeSessionId), sessionId: resumeSessionId })
        resetTerminal()

        // Normal exit (user quit the agent) — proceed to welcome menu
        if (result.exitCode === 0 || result.exitCode === null) { succeeded = true; break }

        // Non-zero exit — agent crashed or failed to start
        const isLastAttempt = attempt === MAX_STARTUP_RETRIES - 1
        if (isLastAttempt) {
          p.log.warn(yellow(`${agent.label} failed to start (exit code ${result.exitCode}).`))
          p.log.info(dim('Falling back to the welcome menu. You can retry from there.'))
          await new Promise(r => setTimeout(r, 2000))
        } else {
          p.log.warn(yellow(`${agent.label} exited unexpectedly (exit code ${result.exitCode}). Retrying...`))
          await new Promise(r => setTimeout(r, 3000))
        }
      }

      if (succeeded) continue
      // Fall through to the interactive welcome menu
    }
    firstIteration = false

    resetTerminal()
    drainStdin()
    console.clear()
    p.intro(`${bold('storyboard terminal')}`)

    // Build the first option based on number of configured agents
    const agentOption = agents.length > 1
      ? { value: 'agents', label: '> Start a new agent session' }
      : { value: 'copilot', label: `> Start a new ${agents[0]?.label || 'Copilot'} session` }

    drainStdin()
    const action = await p.select({
      message: 'How would you like to start?',
      options: [
        agentOption,
        { value: 'shell', label: '> Start a new terminal session' },
        { value: 'sessions', label: '> Browse existing sessions' },
        { value: 'coding-target', label: '> Choose coding target' },
      ],
    })

    if (p.isCancel(action)) {
      // Don't exit to shell on cancel — loop back to welcome
      continue
    }

    if (action === 'coding-target') {
      try { await configureCodingTarget() } catch (error) { p.log.error(error.message) }
      continue
    }

    if (action === 'agents') {
      // Multi-agent sub-select
      drainStdin()
      const agentChoice = await p.select({
        message: 'Which agent?',
        options: agents.map(a => ({
          value: a.id,
          label: `> Start a new ${a.label} session`,
        })),
      })

      if (p.isCancel(agentChoice)) continue

      const agent = agents.find(a => a.id === agentChoice)
      if (agent) {
        await launchAgent(agent)
      }
      continue
    }

    if (action === 'copilot') {
      // Single agent — launch directly
      const agent = agents[0] || { label: 'Copilot', startupCommand: 'copilot --agent terminal-agent' }
      await launchAgent(agent)
      continue
    }

    // Show metadata for non-agent actions (shell, sessions)
    const meta = [
      prettyName ? `${dim('name:')} ${blue(prettyName)}` : null,
      `${dim('branch:')} ${blue(branch)}`,
      `${dim('canvas:')} ${blue(canvasShort)}`,
    ].filter(Boolean).join('  ')
    p.log.info(meta)

    if (action === 'shell') {
      p.outro(dim('Opening shell... Enter any command below.'))
      // Spawn an interactive shell; when it exits, loop back to welcome
      try { await spawnShell() } catch { /* empty */ }
      continue
    }

    if (action === 'sessions') {
      // Sub-menu: pick which agent's sessions to browse, or terminal sessions
      const resumableAgents = agents.filter(a => a.resumeCommand)

      const sessionOptions = [
        ...resumableAgents.map(a => ({
          value: `agent:${a.id}`,
          label: `> ${a.label} sessions`,
        })),
        { value: 'terminal', label: '> Terminal sessions' },
      ]

      drainStdin()
      const sessionChoice = await p.select({
        message: 'Browse sessions',
        options: sessionOptions,
      })

      if (p.isCancel(sessionChoice)) continue

      if (sessionChoice === 'terminal') {
        p.outro(dim('Loading terminal sessions...'))
        try {
          if (!storyboardCliPath) throw new Error('Bundled Storyboard CLI is unavailable')
          const child = spawn(process.execPath, [storyboardCliPath, 'terminal'], {
            stdio: 'inherit',
            cwd: terminalRuntime.cwd,
            env: sessionEnvironment(terminalRuntime),
          })
          await new Promise((resolve) => {
            child.on('close', resolve)
            child.on('error', resolve)
          })
        } catch {
          p.log.error('Failed to load sessions.')
          await new Promise(r => setTimeout(r, 2000))
        }
        continue
      }

      // Agent resume — spawn the resume command interactively. The configured
      // resumeCommand is the full launch template with `{id}` placeholder; for
      // the interactive picker we strip it to `<binary> --resume` so copilot/
      // claude/codex open their built-in session selector.
      if (sessionChoice.startsWith('agent:')) {
        const agentId = sessionChoice.replace('agent:', '')
        const agent = resumableAgents.find(a => a.id === agentId)
        if (agent) {
          p.outro(dim(`Loading ${agent.label} sessions...`))
          try {
            initTerminalConfig(projectRoot)
            const saved = readTerminalConfigById(process.env.STORYBOARD_WIDGET_ID)
            if (saved?.codingTarget || saved?.lastAgentCodingTarget) {
              if (!saved.lastAgentSessionId || saved.lastAgentId !== agent.id) throw new Error('This terminal has no captured session for that agent. Start a new session instead.')
              await launchAgent(agent, { resume: true, sessionId: saved.lastAgentSessionId })
              continue
            }
            const runtime = await resolveAgentHostRuntime(projectRoot, agent.id)
            await launchAgent({ ...agent, startupCommand: `${runtime.definition.executable} --resume` }, { resume: true })
          } catch (error) {
            p.log.error(error.message || `Failed to load ${agent.label} sessions.`)
            await new Promise(r => setTimeout(r, 2000))
          }
        }
        continue
      }

      continue
    }
  }
}

welcomeLoop().catch(() => {
  // On any error, just let the shell take over
})
