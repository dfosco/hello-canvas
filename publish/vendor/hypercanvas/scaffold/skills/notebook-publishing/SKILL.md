---
name: notebook-publishing
description: Publish and troubleshoot Hypercanvas Notebooks through the Core publishing API and CLI, including GitHub Pages operation output and recovery.
metadata:
  author: Daniel Fosco
  version: "2026.10.02"
---

# Notebook Publishing

> Triggered by: publishing or deploying a Hypercanvas Notebook/site, checking a
> publish, or debugging/fixing a failed Notebook publish.

Use the shared Node-only publishing Core API, its `storyboard publish` CLI, or
the matching `/_storyboard/publishing` HTTP API. The CLI and HTTP routes call the
same Core functions. Do not implement a separate GitHub Pages deployment path.

## Important command distinction

- `storyboard publish deploy ...` publishes a Notebook site to GitHub Pages.
- `storyboard publish status ...` reads the publish status and operation logs.
- `storyboard publish retry <operation-id> ...` retries the saved request.
- Bare `storyboard publish` is a legacy Git push command, **not** Notebook
  publishing.

## Publish a Notebook

Before publishing, identify the Notebook root and confirm the requested GitHub
owner, repository, and source visibility. Publishing creates or connects a
repository and pushes public site content; do not choose a repository name,
owner, visibility, or destination on the user's behalf when they have not
provided or approved one. GitHub Pages availability for private repositories
depends on the user's plan.

```sh
storyboard publish deploy <notebook-path> \
  --owner <github-owner> \
  --name <repository> \
  --mode default \
  --repository-mode create \
  --visibility public \
  --json
```

Use `--visibility private` only when requested and supported by the user's
GitHub plan.

For an existing repository, use `--repository-mode connect`. External mode
requires an approved destination:

```sh
storyboard publish deploy <notebook-path> \
  --owner <github-owner> --name <repository> \
  --mode external --destination <site-folder> \
  --repository-mode connect --json
```

The command returns a recorded operation. Preserve its `id`; `result` contains
the repository, Pages URL, Actions run URL, and any publish warnings.

## Inspect and recover

Use the targeted status command to retrieve just one operation rather than
dumping every operation's log:

```sh
storyboard publish status <notebook-path> --operation <operation-id> --json
```

The publishing API also supports:

- `GET /_storyboard/publishing/status` — recent operations and auth state.
- `GET /_storyboard/publishing/operations/<operation-id>` — one complete
  operation record.
- `POST /_storyboard/publishing/retry` with `{"operationId":"..."}` — retry
  the recorded request.

Interpret fields this way:

- `status` is the lifecycle: `running`, `succeeded`, `awaiting_retry`, or
  `failed`.
- `finalStatus` is `null` while running; when finished it is `success`,
  `warning`, or `error`.
- `output` is the bounded, redacted command output used by the Publish recovery
  terminal. Inspect it together with `steps`, `error.code`, `error.hint`, and
  `error.detail` to find the failing command/action.
- `warnings` (also included in a successful `result`) means the publish
  succeeded but has advisory issues to review. Do not report it as failed.
- `awaiting_retry` means an actionable issue stopped the operation; fix the
  cause before retrying. `retry` reuses the saved request. If the owner,
  repository, mode, or other request option must change, start a new deploy
  instead.

```sh
storyboard publish retry <operation-id> <notebook-path> --json
```

Keep terminal output private. It is redacted and stored in the Notebook runtime
state, but still may include file paths and project diagnostics. Never copy
credentials from the environment into commands, logs, or generated content.

## Core API

Server-side Node consumers can import the same functions from
`@dfosco/hypercanvas/publish`:

```js
import {
  publishNotebook,
  getPublishStatus,
  getPublishOperation,
  retryPublish,
} from '@dfosco/hypercanvas/publish'
```

This entry point uses Node filesystem and process APIs. Do not import it from
browser code or `@dfosco/hypercanvas/core`.
