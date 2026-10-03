import { describe, expect, it } from 'vitest'
import { notebookPublishWorkflow, runWorkflow } from './workflow.js'

describe('Notebook publishing workflow runner', () => {
  it('runs the JSON-defined publish pipeline in deterministic order', () => {
    const steps = notebookPublishWorkflow.steps.map(({ id }) => id)
    expect(steps).toEqual([
      'validate',
      'repository-root',
      'generate',
      'build',
      'initialize-repository',
      'repository',
      'workflow',
      'stage',
      'reconcile',
      'commit',
      'push',
      'pages',
      'dispatch',
      'result',
    ])
    expect(steps.indexOf('initialize-repository')).toBeGreaterThan(steps.indexOf('build'))
    expect(steps.indexOf('repository')).toBeGreaterThan(steps.indexOf('initialize-repository'))
  })

  it('passes parameters and prior step outputs to sequential registered actions', async () => {
    const order = []
    const result = await runWorkflow({
      definition: {
        name: 'fixture',
        version: 1,
        steps: [
          { id: 'prepare', uses: 'prepare' },
          { id: 'publish', uses: 'publish', with: { target: 'pages' } },
        ],
      },
      input: { notebookRoot: '/notebook', owner: 'danielfosco' },
      actions: {
        prepare: ({ input }) => {
          order.push('prepare')
          return { root: input.notebookRoot }
        },
        publish: ({ input, outputs, step }) => {
          order.push('publish')
          return { root: outputs.prepare.root, owner: input.owner, target: step.with.target }
        },
      },
      runStep: async (id, execute) => {
        order.push(`start:${id}`)
        const result = await execute()
        order.push(`finish:${id}`)
        return result
      },
    })

    expect(order).toEqual([
      'start:prepare', 'prepare', 'finish:prepare',
      'start:publish', 'publish', 'finish:publish',
    ])
    expect(result.outputs.publish).toEqual({ root: '/notebook', owner: 'danielfosco', target: 'pages' })
  })

  it('rejects unknown actions before running any step', async () => {
    const invoked = []
    await expect(runWorkflow({
      definition: { name: 'invalid', steps: [{ id: 'unsafe', uses: 'shell' }] },
      actions: {},
      runStep: async (_id, execute) => {
        invoked.push(true)
        return execute()
      },
    })).rejects.toThrow('Workflow action is not registered: shell')
    expect(invoked).toEqual([])
  })
})
