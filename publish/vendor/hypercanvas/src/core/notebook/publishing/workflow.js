/**
 * Small deterministic runner for registered Notebook publishing actions.
 * Workflow JSON selects trusted action IDs; it never contains shell strings.
 */

import workflowDefinition from './publish.workflow.json' with { type: 'json' }

export const notebookPublishWorkflow = Object.freeze(workflowDefinition)

function validateDefinition(definition, actions) {
  if (!definition || typeof definition.name !== 'string' || !Array.isArray(definition.steps)) {
    throw new TypeError('Workflow definition must have a name and ordered steps.')
  }
  const ids = new Set()
  for (const step of definition.steps) {
    if (!step || typeof step.id !== 'string' || typeof step.uses !== 'string' || ids.has(step.id)) {
      throw new TypeError('Workflow steps require unique IDs and registered action names.')
    }
    if (typeof actions[step.uses] !== 'function') {
      throw new Error(`Workflow action is not registered: ${step.uses}`)
    }
    ids.add(step.id)
  }
}

/** Execute each registered step sequentially with shared inputs and prior outputs. */
export async function runWorkflow({
  definition = notebookPublishWorkflow,
  actions,
  input = {},
  context = {},
  runStep = (_id, execute) => execute(),
} = {}) {
  validateDefinition(definition, actions || {})
  const outputs = {}
  for (const step of definition.steps) {
    const execute = () => actions[step.uses]({ input, context, outputs, step })
    outputs[step.id] = await runStep(step.id, execute)
  }
  return { input, context, outputs }
}
