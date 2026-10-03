/**
 * Local portable-project builds.
 *
 * Publishing builds `dist/` locally and commits it; GitHub Actions only
 * deploys the committed output (see DOCS/publishing.md). The build installs the
 * project's exact dependencies from its embedded lockfile (`npm ci`), so the
 * same commands verify portability. This work is asynchronous so the server
 * can continue to stream operation progress and status while npm runs.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { publishingError } from './errors.js'
import { recordOperationOutput } from './operations.js'
import { lockfileMatchesDependencies } from './generator.js'

const execFileAsync = promisify(execFile)

async function run(command, args, { cwd, env } = {}) {
  return execFileAsync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env,
  })
}

function outputOf(error) {
  return [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim()
}

function lockfileNeedsRefresh(projectDir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
    const lockfile = JSON.parse(fs.readFileSync(path.join(projectDir, 'package-lock.json'), 'utf8'))
    return !lockfileMatchesDependencies(lockfile, manifest.dependencies)
  } catch {
    return true
  }
}

async function resolveNpm() {
  const bundled = process.env.HYPERCANVAS_BUNDLED_NPM
  for (const candidate of bundled ? [bundled, 'npm'] : ['npm']) {
    try {
      await run(candidate, ['--version'])
      return { command: candidate, prefix: [] }
    } catch {
      if (candidate === 'npm' && bundled) break
    }
  }
  // Fall back to npm-cli.js next to the running Node executable.
  const npmCli = path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
  if (fs.existsSync(npmCli)) return { command: process.execPath, prefix: [npmCli] }
  return null
}

async function runNpm(args, cwd, { env } = {}) {
  const npm = await resolveNpm()
  if (!npm) throw publishingError('NPM_UNAVAILABLE', 'npm is unavailable. Install Node with npm to build published sites.')
  try {
    const result = await run(npm.command, [...npm.prefix, ...args], {
      cwd,
      env: { ...process.env, ...env, npm_config_audit: 'false', npm_config_fund: 'false' },
    })
    recordOperationOutput(`$ npm ${args.join(' ')}`, [result?.stdout, result?.stderr].filter(Boolean).join('\n'))
    return result
  } catch (error) {
    const output = outputOf(error)
    recordOperationOutput(`$ npm ${args.join(' ')}`, output || 'Command failed without output.')
    if (args[0] === 'install' && args.includes('--package-lock-only')) {
      throw publishingError('BUILD_INSTALL_FAILED', 'The published project dependency lockfile could not be prepared.', output, 'Check network access and the imported prototype dependencies, then retry.')
    }
    if (args[0] === 'ci') {
      throw publishingError('BUILD_INSTALL_FAILED', 'The published project dependencies could not be installed (npm ci failed).', output, 'Check network access and the committed package-lock.json, then retry.')
    }
    throw publishingError('PUBLISH_BUILD_FAILED', 'The published site could not be built (vite build failed).', output, 'Inspect the project build output, fix the Notebook content, then retry.')
  }
}

/**
 * Install the project's exact dependencies and build its `dist/`.
 * `vite build` empties only `dist/` — `.git`, the workflow, and unrelated
 * files are untouched.
 */
export async function buildProject({ projectDir, basePath, commandRunner = runNpm } = {}) {
  if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
    throw publishingError('PUBLISH_BUILD_FAILED', 'No published project found to build.', projectDir)
  }
  const commandOptions = basePath ? { env: { VITE_BASE_PATH: basePath } } : undefined
  if (lockfileNeedsRefresh(projectDir)) {
    await commandRunner(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], projectDir, commandOptions)
  }
  await commandRunner(['ci'], projectDir, commandOptions)
  const buildOutput = await commandRunner(['run', 'build'], projectDir, commandOptions)
  const dist = path.join(projectDir, 'dist')
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw publishingError('PUBLISH_BUILD_FAILED', 'The build did not produce dist/index.html.', String(buildOutput?.stdout || buildOutput || ''))
  }
  return { projectDir, dist }
}

export const __test = { runNpm, resolveNpm }
