#!/usr/bin/env node
/**
 * `storyboard publish <command>` — Notebook publication operations.
 *
 * Commands run directly against the selected Notebook root (or active
 * Notebook). Fields map 1:1 to `/_storyboard/publishing` request fields.
 */

import {
  buildPublishSite,
  getPublishOperation,
  publishNotebookProject,
  getPublishStatus,
  publishNotebook,
  retryPublish,
  setupPublishingRepository,
} from '../notebook/publishing.js'
import { resolveNotebookRoot } from './filesystemRoots.js'
import { die, parseSimpleArgs } from './cliHelpers.js'

const [command, ...args] = process.argv.slice(3)
const { positional, flags } = parseSimpleArgs(args)

function requestFields(notebookRoot) {
  return {
    notebookRoot,
    mode: flags.mode || 'default',
    destination: flags.destination,
    repositoryMode: flags['repository-mode'] || 'create',
    owner: flags.owner,
    name: flags.name,
    visibility: flags.visibility || 'private',
    branch: flags.branch || 'main',
  }
}

try {
  let result
  const rootArgument = command === 'retry' ? positional[1] : positional[0]
  const notebookRoot = ['status'].includes(command) && !rootArgument
    ? process.env.STORYBOARD_PROJECT_ROOT || process.env.HYPERCANVAS_NOTEBOOK_ROOT || process.cwd()
    : resolveNotebookRoot(rootArgument)

  if (command === 'status') {
    result = flags.operation
      ? getPublishOperation(notebookRoot, String(flags.operation))
      : getPublishStatus(notebookRoot)
  } else if (command === 'project' || command === 'prepare') {
    result = await publishNotebookProject({
      notebookRoot,
      mode: flags.mode || 'default',
      destination: flags.destination,
    })
  } else if (command === 'build') {
    result = await buildPublishSite({
      notebookRoot,
      mode: flags.mode || 'default',
      destination: flags.destination,
    })
  } else if (command === 'repository') {
    result = await setupPublishingRepository({ root: notebookRoot, notebookRoot, ...requestFields(notebookRoot) })
  } else if (command === 'deploy') {
    result = await publishNotebook({ root: notebookRoot, ...requestFields(notebookRoot) })
  } else if (command === 'retry') {
    if (!positional[0]) die('Usage: storyboard publish retry <operation-id> [notebook]')
    result = await retryPublish({ root: notebookRoot, operationId: positional[0] })
  } else {
  die(`Usage:
  storyboard publish status [notebook] [--operation <id>]
  storyboard publish project [notebook] [--mode default|external] [--destination <path>]
  storyboard publish build [notebook] [--mode default|external] [--destination <path>]
  storyboard publish repository [notebook] --owner <owner> --name <repo> [--mode default|external] [--repository-mode create|connect] [--visibility public|private] [--destination <path>]
  storyboard publish deploy [notebook] --owner <owner> --name <repo> [--mode default|external] [--repository-mode create|connect] [--visibility public|private] [--destination <path>]
  storyboard publish retry <operation-id> [notebook]`)
  }

  if (flags.json) console.log(JSON.stringify(result, null, 2))
  else console.log(JSON.stringify(result, null, 2))

  if (result?.status === 'failed' || result?.status === 'awaiting_retry') process.exitCode = 1
} catch (error) {
  if (flags.json) {
    console.log(JSON.stringify({
      status: 'failed',
      finalStatus: 'error',
      output: [],
      error: {
        code: error?.code || 'PUBLISHING_FAILED',
        message: error?.message || 'Publishing failed',
        detail: error?.detail ?? null,
        hint: error?.hint ?? null,
        actionable: Boolean(error?.actionable),
      },
    }, null, 2))
    process.exitCode = 1
  } else {
    die(error?.hint ? `${error.message}\n${error.hint}` : error.message)
  }
}
