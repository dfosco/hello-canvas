/**
 * storyboard setup — One-time setup for the Storyboard dev environment.
 *
 * Idempotent: safe to run multiple times, only does what's needed.
 *
 * Usage:
 *   npx storyboard setup                          # interactive
 *   npx storyboard setup --skip-branch             # non-interactive, skip branch prompt
 *   npx storyboard setup --skip-repo-config        # skip the storyboard.config.json repo-info update
 *   npx storyboard setup --branch=<name>           # non-interactive, switch to branch after setup
 */

import * as p from '@clack/prompts'
import { existsSync, writeFileSync, mkdirSync, readdirSync, symlinkSync } from 'fs'
import path from 'path'
import { execSync, spawn } from 'child_process'
import { gettingStartedLines, dim, magenta, bold, yellow, green } from './intro.js'
import { parseFlags } from './flags.js'
import { readUserState, writeUserState, getInstalledStoryboardVersion } from './userState.js'
import { withoutRuntimeCredentials } from '../runtimeEnvironment.js'

const flagSchema = {
  'skip-branch': { type: 'boolean', default: false, description: 'Skip the branch prompt at the end' },
  branch: { type: 'string', description: 'Switch to a branch after setup (non-interactive)' },
  'no-buddy': { type: 'boolean', default: false, description: 'Omit the storyboard mascot from setup output' },
  'skip-repo-config': { type: 'boolean', default: false, description: 'Skip the auto-detected repository.config update' },
  'nuke': { type: 'boolean', default: false }, // undocumented: output uninstall command
}

const { flags } = parseFlags(process.argv.slice(3), flagSchema)

// Suppress the mascot when piped into another storyboard command that
// renders its own mascot (e.g. `storyboard dev` auto-runs setup first).
// Respects either the --no-buddy flag or the STORYBOARD_NO_BUDDY env var.
const showMascot = !flags['no-buddy'] && process.env.STORYBOARD_NO_BUDDY !== '1'

// Hidden: output uninstall command for testing fresh setups
if (flags.nuke) {
  const nukeCmd = [
    'brew uninstall gh git 2>/dev/null',
    'rm -f ~/.local/bin/copilot /usr/local/bin/copilot ~/.local/bin/code /usr/local/bin/code',
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"',
    'sudo rm -rf /Library/Developer/CommandLineTools',
    'xcode-select --reset',
    'rm -rf ~/.oh-my-zsh ~/.prezto ~/.zprezto ~/.zplug ~/.zinit ~/.zi ~/.antigen ~/.zim ~/.starship.toml ~/.p10k.zsh 2>/dev/null',
    'rm -f ~/.zshrc ~/.zshenv ~/.zprofile ~/.zlogin ~/.zlogout ~/.bashrc ~/.bash_profile ~/.bash_login ~/.bash_logout ~/.profile 2>/dev/null',
    'echo "# macOS default zsh" > ~/.zshrc',
    'chsh -s /bin/zsh',
  ].join('; ')
  console.log(nukeCmd)
  process.exit(0)
}

/**
 * Async command runner — does NOT block the event loop, so spinners animate.
 */
function runAsync(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      ...opts,
      env: withoutRuntimeCredentials(opts.env || process.env),
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
  })
}

/**
 * Install a brew package with an animated spinner.
 */
async function brewInstall(pkg, label) {
  const spin = p.spinner()
  spin.start(`Installing ${label}`)
  try {
    await runAsync('brew', ['install', pkg])
    spin.stop(`${label} installed`)
    return true
  } catch {
    spin.stop(`Failed to install ${label}`)
    p.log.warning(`Install manually: brew install ${pkg}`)
    return false
  }
}

/**
 * Quick network probe — alerts the user if GitHub looks unreachable.
 * We don't block on failure; downstream installers will surface their own errors.
 */
async function checkNetwork() {
  const http = await import('node:https')
  return new Promise((resolve) => {
    const req = http.request('https://api.github.com', { method: 'HEAD', timeout: 4000 }, (res) => {
      resolve(res.statusCode != null && res.statusCode < 500)
      res.resume()
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

function mascot() {
  const d = dim('·')
  const f = magenta
  const b = dim
  const msg = `  ${bold('Happy prototyping!')} 🎨`
  return [
    `        ${b('╭─────────────────╮')}`,
    `        ${b('│')}  ${d}  ${f('◠')}  ${f('◡')}  ${f('◠')}  ${d}  ${b('│')}${msg}`,
    `        ${b('│')}  ${d}  ${d}  ${d}  ${d}  ${d}  ${b('│')}`,
    `        ${b('╰─────────────────╯')}`,
  ].join('\n')
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'pipe', ...opts })
}

function isInstalled(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

p.intro('storyboard setup')

// 0. Network probe — alert if GitHub is unreachable; don't block.
{
  const online = await checkNetwork()
  if (!online) {
    p.log.warning('Network looks offline — installers/downloads may fail')
    p.log.info(dim('  Tried HEAD https://api.github.com; check VPN/proxy/DNS'))
  } else {
    p.log.success('Network reachable')
  }
}

// Node is assumed to be present (you already ran `npx storyboard setup`).
// node_modules will be installed at the end if missing.

// 2. Homebrew
let hasBrew = isInstalled('brew')
if (!hasBrew) {
  const brewSpin = p.spinner()
  brewSpin.start('Installing Homebrew')
  try {
    run('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"')
    const brewPaths = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', '/home/linuxbrew/.linuxbrew/bin/brew']
    for (const bp of brewPaths) {
      if (existsSync(bp)) {
        process.env.PATH = `${bp.replace(/\/brew$/, '')}:${process.env.PATH}`
        break
      }
    }
    hasBrew = true
    brewSpin.stop('Homebrew installed')
  } catch {
    brewSpin.stop('Failed to install Homebrew')
    p.log.warning('Install manually: https://brew.sh')
  }
}

// 3. Git (install via brew if missing — avoids Xcode CLT requirement)
if (hasBrew) {
  if (isInstalled('git')) {
    p.log.success('Git installed')
  } else {
    await brewInstall('git', 'Git')
  }
}

// 4. Caddy is no longer used. Worktrees run their own Vite directly on
//    `http://localhost:<port>/storyboard/`.

if (hasBrew) {
  // 5. GitHub CLI — required for `gh auth`, `gh pr`, `gh issue` in agents.
  let ghNewlyInstalled = false
  if (isInstalled('gh')) {
    p.log.success('GitHub CLI installed')
  } else {
    ghNewlyInstalled = await brewInstall('gh', 'GitHub CLI')
  }

  // 5a. Surface gh auth status. Even if gh was already installed, we should
  //     prompt the user to log in — agents that shell out to `gh` will fail
  //     silently otherwise.
  if (isInstalled('gh')) {
    let authed = false
    try {
      execSync('gh auth status', { stdio: 'ignore' })
      authed = true
    } catch { /* not authed */ }
    if (authed) {
      p.log.success('GitHub CLI authenticated')
    } else {
      p.log.warning(ghNewlyInstalled ? 'GitHub CLI installed but not logged in' : 'GitHub CLI is not logged in')
      p.log.info(`  Run ${yellow('gh auth login')} to authenticate`)
    }
  }
}

// 5c. Configure storyboard.config.json with the current repo identity.
//     Uses `gh repo view` to detect owner/name, then offers to update
//     mismatching fields (e.g. when the user clones a template).
//     Skips silently when gh isn't installed/authed or no remote exists.
if (!flags['skip-repo-config']) {
  try {
    const { configureRepository } = await import('./configureRepository.js')
    await configureRepository({ nonInteractive: false })
  } catch (err) {
    p.log.warning(`Repo config step failed: ${err.message}`)
  }
}

// 6. VS Code CLI
if (isInstalled('code')) {
  p.log.success('VS Code CLI installed')
} else {
  const vsCodeApp = '/Applications/Visual Studio Code.app'
  const shellScript = `${vsCodeApp}/Contents/Resources/app/bin/code`
  let installed = false

  if (existsSync(shellScript)) {
    // Try /usr/local/bin first, then ~/.local/bin as fallback
    const localBin = `${process.env.HOME}/.local/bin`
    const targets = ['/usr/local/bin/code', `${localBin}/code`]

    for (const target of targets) {
      try {
        const dir = path.dirname(target)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        run(`ln -sf "${shellScript}" "${target}"`)
        // Add ~/.local/bin to PATH if that's where we installed
        if (target.includes('.local/bin') && !process.env.PATH.includes(localBin)) {
          process.env.PATH = `${localBin}:${process.env.PATH}`
        }
        p.log.success(`VS Code CLI installed (${target})`)
        installed = true
        break
      } catch {
        // Try next target
      }
    }
  }

  if (!installed) {
    if (existsSync(vsCodeApp)) {
      p.log.warning('VS Code found but could not create symlink. Open VS Code and run:')
    } else {
      p.log.warning('VS Code not found. Install VS Code, then run:')
    }
    p.log.info('  Cmd+Shift+P → "Shell Command: Install \'code\' command in PATH"')
  }
}

// 6a. Coding agents (Copilot CLI / Claude Code / Codex CLI).
//     On first-time setup, ask the user which agents they want installed.
//     On subsequent runs, only install the previously-opted-in agents that
//     went missing — never re-prompt to avoid being annoying after upgrades.
{
  const priorState = readUserState()
  const priorAgents = priorState.agents || null
  const firstRun = !priorState.setupVersion

  const ensureLocalBinOnPath = () => {
    const localBin = `${process.env.HOME}/.local/bin`
    if (!process.env.PATH.includes(localBin)) {
      process.env.PATH = `${localBin}:${process.env.PATH}`
    }
  }

  const installers = {
    copilot: {
      label: 'Copilot CLI',
      bin: 'copilot',
      install: async () => {
        await runAsync('bash', ['-c', 'curl -fsSL https://gh.io/copilot-install | bash'])
        ensureLocalBinOnPath()
      },
      manualHint: 'curl -fsSL https://gh.io/copilot-install | bash',
      authHint: `Auth is separate from gh — run ${yellow('copilot')} then ${yellow('/login')}`,
    },
    claude: {
      label: 'Claude Code',
      bin: 'claude',
      install: async () => {
        await runAsync('bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'])
        ensureLocalBinOnPath()
      },
      manualHint: 'curl -fsSL https://claude.ai/install.sh | bash',
      authHint: `Run ${yellow('claude')} once to authenticate`,
    },
    codex: {
      label: 'Codex CLI',
      bin: 'codex',
      install: async () => {
        await runAsync('npm', ['install', '-g', '@openai/codex'])
      },
      manualHint: 'npm i -g @openai/codex',
      authHint: `Run ${yellow('codex login')} to authenticate`,
    },
  }

  let chosen
  if (firstRun) {
    const selection = await p.multiselect({
      message: 'Which coding agents do you want installed?',
      options: [
        { value: 'copilot', label: 'Copilot CLI', hint: 'recommended' },
        { value: 'claude', label: 'Claude Code' },
        { value: 'codex', label: 'Codex CLI' },
      ],
      initialValues: ['copilot'],
      required: false,
    })
    if (p.isCancel(selection)) {
      chosen = { copilot: true, claude: false, codex: false }
    } else {
      chosen = Object.fromEntries(Object.keys(installers).map((k) => [k, selection.includes(k)]))
    }
  } else {
    // Returning user — install only what they previously opted into and is
    // currently missing. If we have no record (older setup), default to
    // re-installing copilot only when missing.
    chosen = priorAgents || { copilot: true, claude: false, codex: false }
  }

  for (const [key, agent] of Object.entries(installers)) {
    if (!chosen[key]) continue
    if (isInstalled(agent.bin)) {
      p.log.success(`${agent.label} installed`)
      p.log.info(`  ${agent.authHint}`)
      continue
    }
    const spin = p.spinner()
    spin.start(`Installing ${agent.label}`)
    try {
      await agent.install()
      spin.stop(`${agent.label} installed`)
      if (!isInstalled(agent.bin)) {
        p.log.warning(`${agent.bin} not on PATH — add ${yellow('export PATH="$HOME/.local/bin:$PATH"')} to your shell rc`)
      }
      p.log.info(`  ${agent.authHint}`)
    } catch {
      spin.stop(`Failed to install ${agent.label}`)
      p.log.warning(`Install manually: ${agent.manualHint}`)
    }
  }

  // Persist the choice so future setups know what to keep installed.
  writeUserState({ agents: chosen })
}

// 8. Git hooks
{
  // Create .githooks/ if it doesn't exist — copy from scaffold template
  if (!existsSync('.githooks')) {
    const scaffoldHooks = path.resolve(import.meta.dirname, '..', '..', 'scaffold', 'githooks')
    if (existsSync(scaffoldHooks)) {
      try {
        run(`cp -r "${scaffoldHooks}" .githooks`)
        run('chmod +x .githooks/*')
      } catch { /* fall through */ }
    }
  }

  if (existsSync('.githooks')) {
    try {
      run('git config core.hooksPath .githooks')
      if (existsSync('.githooks/pre-push')) {
        run('chmod +x .githooks/pre-push')
      }
      p.log.success('Git hooks activated (.githooks/)')
    } catch {
      p.log.warning('Failed to set git hooks path')
    }
  } else {
    p.log.info(dim('No .githooks/ directory — run storyboard-scaffold first'))
  }
}

// 9. Asset directories
{
  const dirs = ['assets/canvas/images', 'assets/.storyboard-public/terminal-snapshots', '.storyboard', '.storyboard/terminals', '.storyboard/terminal-buffers', '.storyboard/logs']
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    }
  }

  // Scaffold initial .selectedwidgets.json if missing
  const selectedWidgetsPath = '.storyboard/.selectedwidgets.json'
  if (!existsSync(selectedWidgetsPath)) {
    try {
      writeFileSync(selectedWidgetsPath, JSON.stringify({
        canvasId: null,
        canvasFile: null,
        selectedWidgetIds: [],
        widgets: [],
      }, null, 2) + '\n', 'utf-8')
    } catch { /* ignore */ }
  }

  p.log.success('Canvas asset directories ready')
}

// 7a. Scaffold .gitignore entries for storyboard runtime + private files.
//     Source of truth is `scaffold/gitignore` (with a `runtime-state`
//     fragment that the scaffolder keeps in sync). We invoke the scaffolder
//     in fragments-only mode here so the patterns get refreshed on every
//     setup, even when no whole-file copy is due.
{
  const gitignorePath = '.gitignore'
  if (existsSync(gitignorePath)) {
    try {
      execSync('npx --no-install storyboard-scaffold --fragments-only', {
        stdio: 'ignore',
        cwd: process.cwd(),
      })
      p.log.success('Synced storyboard fragments in .gitignore')
    } catch {
      p.log.info(dim('  Could not run storyboard-scaffold — run it manually to refresh .gitignore'))
    }
  }
}

// 7b. Copilot agents
{
  const agentsDir = '.agents'
  if (!existsSync(agentsDir)) {
    try { mkdirSync(agentsDir, { recursive: true }) } catch { /* ignore */ }
  }

  const scaffoldAgents = path.resolve(import.meta.dirname, '..', '..', 'scaffold', 'agents')
  if (existsSync(scaffoldAgents)) {
    try {
      const agentFiles = execSync(`ls "${scaffoldAgents}"`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
      for (const file of agentFiles) {
        const dest = path.join(agentsDir, file)
        if (!existsSync(dest)) {
          run(`cp "${path.join(scaffoldAgents, file)}" "${dest}"`)
        }
      }
      if (agentFiles.length > 0) {
        p.log.success('Copilot agents scaffolded (.agents/)')
      }
    } catch { /* ignore */ }
  }

  // Create symlinks in each CLI's expected agent directory.
  // Source of truth: .agents/*.agent.md
  // Copilot CLI reads .github/agents/*.md
  // Claude Code reads .claude/agents/*.md
  // Codex CLI uses .codex/config.toml (no agent files needed)
  try {
    const agentFiles = readdirSync(agentsDir).filter(f => f.endsWith('.agent.md'))
    const targets = [
      { dir: path.join('.github', 'agents'), label: 'Copilot CLI' },
      { dir: path.join('.claude', 'agents'), label: 'Claude Code' },
    ]
    for (const { dir, label } of targets) {
      try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
      let linked = 0
      for (const file of agentFiles) {
        const linkName = file.replace('.agent.md', '.md')
        const linkPath = path.join(dir, linkName)
        const target = path.relative(dir, path.join(agentsDir, file))
        if (!existsSync(linkPath)) {
          try { symlinkSync(target, linkPath); linked++ } catch { /* ignore */ }
        }
      }
      if (linked > 0) {
        p.log.success(`${label} agent symlinks created (${dir}/)`)
      }
    }
  } catch { /* ignore */ }
}

// 10. Install / sync dependencies
{
  const installSpin = p.spinner()
  installSpin.start('Installing dependencies')
  try {
    await runAsync('npm', ['install'])
    installSpin.stop('Dependencies installed')
  } catch {
    installSpin.stop('npm install failed')
    p.log.warning('Run it manually to see details:')
    p.log.info(`  ${dim('npm install')}`)
  }
}

// 11. Stamp the user-state marker so `npm run dev` knows setup is fresh
//     and won't re-run it until the storyboard package version changes.
{
  const version = getInstalledStoryboardVersion() || 'unknown'
  writeUserState({ setupVersion: version, setupRanAt: new Date().toISOString() })
  p.log.success(`Setup marker written (.storyboard/.user.json @ ${version})`)
}

p.note(
  [
    ...gettingStartedLines(),
    '',
    `  ${dim('Run')} ${yellow('npx storyboard')} ${dim('to see all commands')}`,
  ].join('\n'),
  'Getting started'
)

// Offer branch guide
{
  // Non-interactive: --branch=<name> or --skip-branch
  if (flags.branch) {
    const { runBranchGuide } = await import('./branch.js')
    await runBranchGuide(flags.branch)
  } else if (flags['skip-branch']) {
    if (showMascot) {
      console.log()
      console.log(mascot())
    }
    p.outro('')
  } else {
    // Interactive: ask the user
    let currentBranchName = 'main'
    try {
      currentBranchName = execSync('git branch --show-current', { encoding: 'utf8' }).trim() || 'main'
    } catch { /* empty */ }

    const wantBranch = await p.select({
      message: 'Want to work from a different branch?',
      options: [
        { value: true, label: 'Yes (help me create it)' },
        { value: false, label: `No (stay on current branch ${bold(currentBranchName)})` },
      ],
      initialValue: false,
    })

    if (!p.isCancel(wantBranch) && wantBranch) {
      const { runBranchGuide } = await import('./branch.js')
      await runBranchGuide()
    } else {
      if (showMascot) {
        console.log()
        console.log(mascot())
      }
      p.log.info(`${dim('Non-interactive:')} ${green('npx sb setup --skip-branch')}`)
      p.outro('')
    }
  }
}
