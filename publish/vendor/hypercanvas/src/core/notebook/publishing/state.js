/**
 * Persistent publishing state.
 *
 * Lives in the Notebook runtime directory (`.storyboard/publishing.json`) and
 * never enters a commit. Holds the destination bindings per repository mode,
 * operation records for progress and retry, and the legacy provider credential
 * store (the release flow authenticates through the signed-in `gh` CLI).
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { resolveNotebookRuntimePath } from '../runtime.js'

const STATE_FILE = 'publishing.json'

export function runtimePath(root) { return resolveNotebookRuntimePath(root, STATE_FILE) }

export function readState(root) {
  try {
    const state = JSON.parse(fs.readFileSync(runtimePath(root), 'utf8'))
    return {
      credentials: state.credentials ?? {},
      bindings: state.bindings ?? {},
      operations: state.operations ?? {},
      projects: state.projects ?? {},
    }
  } catch {
    return { credentials: {}, bindings: {}, operations: {}, projects: {} }
  }
}

export function writeState(root, state) {
  const destination = runtimePath(root)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`)
  fs.renameSync(temporary, destination)
}

export function withState(root, mutator) {
  const state = readState(root)
  const result = mutator(state)
  writeState(root, state)
  return result
}

/** Persist only after asynchronous mutations have completed. */
export async function withStateAsync(root, mutator) {
  const state = readState(root)
  const result = await mutator(state)
  writeState(root, state)
  return result
}

export function operationId() { return `operation_${randomUUID().replaceAll('-', '')}` }

/** Record a binding between a repository mode and its destination/repository. */
export function saveBinding(state, mode, binding) {
  state.bindings[mode] = {
    ...(state.bindings[mode] ?? {}),
    ...binding,
    mode,
    updatedAt: new Date().toISOString(),
  }
  return state.bindings[mode]
}

export function readBinding(state, mode) { return state.bindings[mode] ?? null }
