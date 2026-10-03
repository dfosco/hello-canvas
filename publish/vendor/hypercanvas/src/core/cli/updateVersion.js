/**
 * storyboard update[:channel|:version] — Update all @dfosco/hypercanvas-* packages.
 *
 * Usage:
 *   storyboard update                  # update to latest stable
 *   storyboard update:version 4.0.0    # update to specific version
 *   storyboard update:4.0.0-beta.1     # update to specific version (shorthand)
 *   storyboard update:beta             # update to latest beta
 *   storyboard update:alpha            # update to latest alpha
 */

import * as p from '@clack/prompts'
import { execSync } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'

const command = process.argv[2]
const channels = { 'update:beta': 'beta', 'update:alpha': 'alpha' }

let channel, targetVersion
if (channels[command]) {
  channel = channels[command]
} else if (command === 'update:version') {
  targetVersion = process.argv[3]
} else if (command && command.startsWith('update:')) {
  // update:<version> shorthand, e.g. update:4.0.0-beta.1
  targetVersion = command.slice('update:'.length)
}

const pkgPath = resolve(process.cwd(), 'package.json')
let pkg
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
} catch (err) {
  p.log.error(`Failed to read package.json: ${err.message}`)
  process.exit(1)
}

// Collect all @dfosco/hypercanvas* packages from deps and devDeps
const storyboardPkgs = new Set()
for (const depField of ['dependencies', 'devDependencies']) {
  if (!pkg[depField]) continue
  for (const name of Object.keys(pkg[depField])) {
    if (name === '@dfosco/hypercanvas' || name.startsWith('@dfosco/hypercanvas-') || name === '@dfosco/tiny-canvas') {
      storyboardPkgs.add(name)
    }
  }
}

if (storyboardPkgs.size === 0) {
    p.log.warn('No @dfosco/hypercanvas packages found in package.json')
  process.exit(0)
}

const tag = channel || (targetVersion ? undefined : 'latest')
const suffix = targetVersion ? `@${targetVersion}` : `@${tag}`
const packages = [...storyboardPkgs].map(name => `${name}${suffix}`).join(' ')

// Resolve actual version from the registry when using a tag (channel or latest)
let resolvedVersion
if (tag) {
  try {
    const probe = [...storyboardPkgs][0]
    resolvedVersion = execSync(`npm view ${probe}@${tag} version`, { encoding: 'utf8' }).trim()
  } catch { /* fall back to showing the tag */ }
}

const displayVersion = resolvedVersion || targetVersion || tag
const label = resolvedVersion && channel ? `to ${resolvedVersion} (${channel})` : resolvedVersion ? `to ${resolvedVersion}` : channel ? `to ${channel}` : targetVersion ? `to ${targetVersion}` : ''
p.intro(`storyboard ${command}`)
p.log.info(`Updating ${storyboardPkgs.size} package(s)${label ? ` ${label}` : ''}…`)
for (const name of storyboardPkgs) {
  p.log.message(`  ${name}@${displayVersion}`)
}

try {
  execSync(`npm install ${packages}`, { stdio: 'inherit', cwd: process.cwd() })
  p.log.success('All storyboard packages updated')
} catch {
  p.log.error('Failed to update packages — see npm output above')
  process.exit(1)
}

// Sync scaffold files (skills, scripts) from the updated package
p.log.info('Syncing scaffold files…')
try {
  execSync('npx storyboard-scaffold', { stdio: 'inherit', cwd: process.cwd() })
} catch {
  p.log.warn('Scaffold sync failed — run `npx storyboard-scaffold` manually')
}

function checkArtifactDiscoveryWorkflow() {
  const cwd = process.cwd()
  const workflows = [
    { name: 'deploy.yml', path: resolve(cwd, '.github', 'workflows', 'deploy.yml') },
    { name: 'preview.yml', path: resolve(cwd, '.github', 'workflows', 'preview.yml') },
  ].filter(workflow => existsSync(workflow.path))

  if (workflows.length === 0) return

  const scriptTarget = resolve(cwd, '.github', 'workflows', 'scripts', 'aggregate-artifacts.mjs')
  const scriptSource = resolve(cwd, 'node_modules', '@dfosco', 'storyboard', 'scaffold', 'scripts', 'aggregate-artifacts.mjs')

  if (!existsSync(scriptTarget)) {
    if (existsSync(scriptSource)) {
      mkdirSync(dirname(scriptTarget), { recursive: true })
      copyFileSync(scriptSource, scriptTarget)
      p.log.success('Installed .github/workflows/scripts/aggregate-artifacts.mjs')
    } else {
      p.log.warn('Missing .github/workflows/scripts/aggregate-artifacts.mjs — copy it from node_modules/@dfosco/hypercanvas/scaffold/scripts/')
    }
  }

  for (const workflow of workflows) {
    let contents
    try {
      contents = readFileSync(workflow.path, 'utf8')
    } catch {
      continue
    }

    if (!contents.includes('aggregate-artifacts.mjs') && !contents.includes('storyboard-aggregate-artifacts')) {
      p.log.warn(`${workflow.name} is missing the cross-branch artifacts index step — copy the workflow changes from node_modules/@dfosco/hypercanvas/scaffold/`)
    }
  }
}

p.log.info('Checking cross-branch artifact workflow integration…')
checkArtifactDiscoveryWorkflow()

// Auto-commit the version update (only if package.json or lock file changed)
try {
  // Read the installed version from the storyboard package (try unified first, then legacy core)
  let installedVersion
  try {
    const unified = JSON.parse(readFileSync(resolve(process.cwd(), 'node_modules', '@dfosco', 'storyboard', 'package.json'), 'utf8'))
    installedVersion = unified.version
  } catch {
    try {
      const core = JSON.parse(readFileSync(resolve(process.cwd(), 'node_modules', '@dfosco', 'storyboard-core', 'package.json'), 'utf8'))
      installedVersion = core.version
    } catch { /* empty */ }
  }
  installedVersion = installedVersion || suffix.slice(1)
  const commitMsg = `[storyboard-update] Update storyboard to ${installedVersion}`

  // Stage update-related files (package.json, lock files, scaffold outputs).
  // The Tier-1 package-owned infra configs + library are force-synced by the
  // scaffold pass and must be committed so `storyboard update` is fully
  // hands-off — customers never hand-patch these. User-facing *.config.json
  // (storyboard.config.json, terminal.config.json, …) are intentionally NOT
  // staged — those are customer-owned.
  const filesToStage = [
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '.github/skills',
    '.github/workflows/scripts/aggregate-artifacts.mjs',
    'scripts',
    // Tier-1 package-owned infrastructure (force-synced):
    'vite.config.js',
    'vitest.config.js',
    'eslint.config.js',
    'tsconfig.json',
    'src/library',
  ]
  for (const f of filesToStage) {
    try { execSync(`git add ${f}`, { cwd: process.cwd(), stdio: 'pipe' }) } catch { /* empty */ }
  }

  // Svelte was removed from the storyboard base — drop the stale empty stub
  // from existing customer repos so the update sheds it automatically.
  try {
    execSync('git rm --quiet --ignore-unmatch svelte.config.js', { cwd: process.cwd(), stdio: 'pipe' })
  } catch { /* empty */ }

  // Only commit if there are staged changes
  try {
    execSync('git diff --cached --quiet', { cwd: process.cwd(), stdio: 'pipe' })
    p.log.message('No changes to commit — already up to date')
  } catch {
    execSync(`git commit -m "${commitMsg}"`, { cwd: process.cwd(), stdio: 'pipe' })
    p.log.success(`Committed: ${commitMsg}`)
  }
} catch (err) {
  p.log.warn(`Auto-commit failed: ${err.message}`)
}

p.outro('Done')
