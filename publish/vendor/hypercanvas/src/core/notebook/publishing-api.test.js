import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deployPublish,
  getPublishOperation,
  getPublishStatus,
  publishNotebook,
  publishingStatus,
  retryPublish,
  retryPublishOperation,
} from './publishing.js'
import { createPublishingHandler } from './publishing-routes.js'
import { recordOperationOutput, runOperation } from './publishing/operations.js'
import { writeState } from './publishing/state.js'

const roots = []

function temp(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `storyboard-${name}-`))
  roots.push(root)
  return root
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('Notebook publishing Core API', () => {
  it('exports the canonical Node API through the public package entry point', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('packages/storyboard/package.json'), 'utf8'))
    expect(packageJson.exports['./publish']).toBe('./src/core/notebook/publishing.js')
    expect(packageJson.exports['./notebook/publishing']).toBe(packageJson.exports['./publish'])
    expect(publishNotebook).toBe(deployPublish)
    expect(getPublishOperation).toBeTypeOf('function')
    expect(getPublishStatus).toBe(publishingStatus)
    expect(retryPublish).toBe(retryPublishOperation)
  })

  it('returns targeted operation output, warnings, and final outcome through HTTP and Core', async () => {
    const root = temp('publish-operation-api')
    const state = { credentials: {}, bindings: {}, projects: {}, operations: {} }
    const operation = await runOperation({
      state,
      kind: 'publish',
      request: { mode: 'default' },
      persist: () => writeState(root, state),
      run: async (step) => {
        await step('build', async () => {
          recordOperationOutput('$ npm run build', 'Build completed\nghp_abcdefghijklmnopqrstuvwxyz123456')
          return null
        })
        return { warnings: [{ code: 'FRAME_WARNING', message: 'Preview unavailable' }] }
      },
    })
    const handler = createPublishingHandler({
      root,
      getNotebookRoot: () => root,
      sendJson: (_res, status, body) => ({ status, body }),
    })

    const response = await handler({}, {}, { method: 'GET', path: `/operations/${operation.id}`, body: {} })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'succeeded',
      finalStatus: 'warning',
      warnings: [{ code: 'FRAME_WARNING', message: 'Preview unavailable' }],
      output: ['$ npm run build\nBuild completed\n[redacted]'],
    })
    expect(JSON.stringify(response.body.output)).not.toContain('ghp_')
    expect(getPublishOperation(root, operation.id)).toEqual(response.body)

    const missing = await handler({}, {}, { method: 'GET', path: '/operations/missing', body: {} })
    expect(missing.status).toBe(422)
    expect(missing.body).toMatchObject({ finalStatus: 'error', status: 'failed', error: { code: 'OPERATION_NOT_FOUND' } })
  })

  it('reports null while running and explicit success/error final outcomes', async () => {
    const root = temp('publish-operation-final-status')
    const state = { operations: {} }
    let finish
    const pending = runOperation({
      state,
      persist: () => writeState(root, state),
      kind: 'publish',
      request: {},
      run: () => new Promise((resolve) => { finish = resolve }),
    })
    const operationId = Object.keys(state.operations)[0]
    expect(getPublishOperation(root, operationId).finalStatus).toBeNull()
    finish({ pagesUrl: 'https://example.github.io/site/' })
    expect(await pending).toMatchObject({ status: 'succeeded', finalStatus: 'success', warnings: [] })

    const failed = await runOperation({
      state,
      kind: 'publish',
      request: {},
      run: async (step) => {
        await step('push', async () => {
          throw Object.assign(new Error('Push rejected'), { code: 'GIT_FAILED', output: 'git push rejected' })
        })
      },
    })
    expect(failed).toMatchObject({ status: 'failed', finalStatus: 'error', error: { code: 'GIT_FAILED' } })
  })
})
