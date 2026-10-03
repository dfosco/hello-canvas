import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const cliPath = resolve(import.meta.dirname, '..', 'cli', 'index.js')

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

export function verifyProductionBuild(cwd, { run = spawnSync } = {}) {
  const result = run(npmCommand(), ['run', 'build'], {
    cwd,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Production build failed with exit code ${result.status ?? 'unknown'}`)
  }
}

export function verifyDevServer(cwd, { start = spawn, timeoutMs = 30_000 } = {}) {
  return new Promise((resolveReady, rejectReady) => {
    const stateDir = mkdtempSync(join(tmpdir(), 'hypercanvas-readiness-'))
    const child = start(process.execPath, [cliPath, 'dev', '--desktop', '--port=0'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BROWSER: 'none',
        NO_COLOR: '1',
        STORYBOARD_NO_BUDDY: '1',
        HYPERCANVAS_PROXY_PORT: '0',
        HYPERCANVAS_APP_STATE_DIR: stateDir,
        HYPERCANVAS_PASEO_ISOLATED: '1',
      },
    })
    let settled = false
    let stdout = ''
    let stderr = ''

    const stop = () => {
      try { child.kill('SIGTERM') } catch { /* process already exited */ }
    }
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      stop()
      if (error) rejectReady(error)
      else resolveReady()
    }
    const inspectLine = (line) => {
      if (!line) return
      let event
      try { event = JSON.parse(line) } catch { return }
      if (event?.source !== 'storyboard-dev') return
      if (event.event === 'ready') finish()
      if (event.event === 'error') finish(new Error(event.message || 'Dev server startup failed'))
    }
    const timeout = setTimeout(() => {
      const details = stderr.trim() || stdout.trim()
      finish(new Error(`Timed out waiting for the dev server to become ready${details ? `: ${details}` : ''}`))
    }, timeoutMs)
    timeout.unref?.()

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
      const lines = stdout.split('\n')
      stdout = lines.pop() || ''
      for (const line of lines) inspectLine(line)
    })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      rmSync(stateDir, { recursive: true, force: true })
      finish(new Error(`Could not start the dev server: ${error.message}`))
    })
    child.on('exit', (code) => {
      rmSync(stateDir, { recursive: true, force: true })
      if (!settled) {
        const details = stderr.trim() || stdout.trim()
        finish(new Error(`Dev server exited before becoming ready (exit ${code ?? 'unknown'})${details ? `: ${details}` : ''}`))
      }
    })
  })
}

export async function verifyWorkflowReadiness(cwd, {
  build = verifyProductionBuild,
  devServer = verifyDevServer,
} = {}) {
  build(cwd)
  await devServer(cwd)
}
