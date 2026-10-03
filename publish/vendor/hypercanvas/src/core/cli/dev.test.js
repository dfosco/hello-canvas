import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'

const tempDirs = []

function makeTempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

it('uses the browser-first Storyboard CLI for the root dev command', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'))
  expect(manifest.scripts.dev).toBe('storyboard dev')
})

it('launches verbose desktop dev after provisioning a startup scaffold', async () => {
  const home = makeTempDir('hypercanvas-home-')
  const template = makeTempDir('hypercanvas-template-')
  const project = makeTempDir('hypercanvas-project-')
  const cli = path.resolve(process.cwd(), 'packages/storyboard/src/core/cli/index.js')
  for (const entry of ['canvas', 'prototypes', 'assets', 'sites']) fs.mkdirSync(path.join(template, entry))
  fs.writeFileSync(path.join(template, 'hypercanvas.notebook.json'), '{}')
  fs.writeFileSync(path.join(template, 'storyboard.canvas.json'), '{}')

  const child = spawn(process.execPath, [cli, 'dev', '--desktop', '--verbose', '--port=0'], {
    cwd: project,
      env: {
        ...process.env,
        HOME: home,
        HYPERCANVAS_DEMO_NOTEBOOK_TEMPLATE: template,
        HYPERCANVAS_APP_STATE_DIR: home,
        STORYBOARD_TEST_SKIP_PASEO: '1',
        HYPERCANVAS_INSTANCE_PROXY: '0',
      },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const completed = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Desktop dev CLI did not become ready. Output: ${output}`))
    }, 15000)
    const onData = chunk => {
      output += chunk.toString()
      if (output.includes('"event":"ready"')) child.kill('SIGTERM')
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => {
      clearTimeout(timeout)
      if (output.includes('"event":"ready"')) resolve(true)
      else reject(new Error(`Desktop dev CLI exited ${code}. Output: ${output}`))
    })
  })

  expect(completed).toBe(true)
  expect(output).toContain('"event":"ready"')
  expect(output).not.toContain("Cannot access 'verbose' before initialization")
})
