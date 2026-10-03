import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { resolveNotebookPath } from '../notebook/runtime.js'
import { filesystemGrants as defaultFilesystemGrants, isFilesystemGrantPurpose } from './filesystem-grants.js'

const execFileAsync = promisify(execFile)
const MAX_IMPORTED_FILE_BYTES = 50 * 1024 * 1024

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function systemError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

async function pickWithAppleScript(kind) {
  if (process.platform !== 'darwin') {
    throw systemError('SYSTEM_PICKER_UNAVAILABLE', 'The native file picker is unavailable on this platform.')
  }
  const expression = kind === 'directory'
    ? 'POSIX path of (choose folder with prompt "Choose a folder for Hypercanvas")'
    : 'POSIX path of (choose file with prompt "Choose a file for Hypercanvas")'
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', expression], {
      timeout: 5 * 60 * 1000,
      maxBuffer: 4096,
      encoding: 'utf8',
    })
    const selected = stdout.trim()
    if (!selected.startsWith('/')) throw systemError('INVALID_SELECTION', 'The native picker returned an invalid path.')
    return selected
  } catch (error) {
    if (String(error?.stderr || error?.message || '').includes('-128')) return null
    throw systemError('SYSTEM_PICKER_FAILED', `Could not open the native ${kind} picker: ${error.message}`)
  }
}

export function createSystemRoutes({
  sendJson: send = sendJson,
  selectDirectory = () => pickWithAppleScript('directory'),
  selectFile = () => pickWithAppleScript('file'),
  filesystemGrants = defaultFilesystemGrants,
  getNotebookRoot = () => process.env.HYPERCANVAS_NOTEBOOK_ROOT || null,
  eventSender,
} = {}) {
  async function importSelectedFile() {
    const selected = await selectFile()
    if (!selected) return { path: null, cancelled: true }

    const root = getNotebookRoot()
    if (!root) throw systemError('NO_ACTIVE_NOTEBOOK', 'Open a Notebook before importing a file.')
    let source
    try { source = fs.realpathSync.native(path.resolve(selected)) } catch {
      throw systemError('SELECTED_FILE_UNAVAILABLE', 'The selected file is no longer available.')
    }
    let metadata
    try { metadata = fs.statSync(source) } catch {
      throw systemError('SELECTED_FILE_UNAVAILABLE', 'The selected file is no longer available.')
    }
    if (!metadata.isFile()) throw systemError('INVALID_SELECTION', 'Choose a file, not a folder.')
    if (metadata.size > MAX_IMPORTED_FILE_BYTES) {
      throw systemError('FILE_TOO_LARGE', 'The selected file exceeds the 50 MB import limit.')
    }

    let notebookRoot
    try { notebookRoot = fs.realpathSync.native(path.resolve(root)) } catch {
      throw systemError('NOTEBOOK_UNAVAILABLE', 'The active Notebook folder is no longer available.')
    }
    if (!fs.statSync(notebookRoot).isDirectory()) {
      throw systemError('NOTEBOOK_UNAVAILABLE', 'The active Notebook folder is no longer available.')
    }
    const destinationDirectory = resolveNotebookPath(notebookRoot, 'assets/files')
    fs.mkdirSync(destinationDirectory, { recursive: true })
    const checkedDestinationDirectory = resolveNotebookPath(notebookRoot, 'assets/files')
    const originalFilename = path.basename(source).replaceAll('\\', '_')
    const extension = path.extname(originalFilename)
    const base = path.basename(originalFilename, extension)
    let index = 0
    let filename
    let destination
    while (true) {
      filename = index === 0 ? path.basename(source) : `${base}--${index}${extension}`
      filename = filename.replaceAll('\\', '_')
      destination = path.join(checkedDestinationDirectory, filename)
      index += 1
      try {
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
        break
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
    }
    const relativePath = path.posix.join('assets', 'files', filename)
    eventSender?.({ type: 'custom', event: 'storyboard:file-changed', data: { path: relativePath } })
    return { path: relativePath, cancelled: false }
  }

  return async (req, res, ctx = {}) => {
    const route = String(ctx.path || '/').replace(/^\//, '').split('?')[0]
    if (ctx.method !== 'POST' || !['select-directory', 'select-file', 'import-file'].includes(route)) {
      send(res, 404, { error: { code: 'SYSTEM_ROUTE_NOT_FOUND', message: 'System route not found.' } })
      return
    }
    try {
      if (route === 'import-file') {
        send(res, 200, await importSelectedFile())
        return
      }
      if (route === 'select-directory') {
        const purpose = ctx.body?.purpose || 'notebook'
        if (!isFilesystemGrantPurpose(purpose)) {
          throw systemError('INVALID_FILESYSTEM_GRANT_PURPOSE', 'Directory selection purpose must be notebook or site.')
        }
        const selected = await selectDirectory({ purpose, e2eDirectory: ctx.body?.e2eDirectory })
        const grantedPath = selected ? filesystemGrants.grantDirectory(selected, { purpose, request: req }) : null
        send(res, 200, { path: grantedPath, cancelled: grantedPath == null })
        return
      }
      const selected = await selectFile()
      send(res, 200, { path: selected || null, cancelled: selected == null })
    } catch (error) {
      const status = {
        SYSTEM_PICKER_UNAVAILABLE: 501,
        FILESYSTEM_ORIGIN_NOT_ALLOWED: 403,
        NO_ACTIVE_NOTEBOOK: 409,
        NOTEBOOK_UNAVAILABLE: 409,
        INVALID_FILESYSTEM_GRANT_PURPOSE: 400,
        INVALID_FILESYSTEM_ROOT: 400,
        FILESYSTEM_ROOT_FORBIDDEN: 400,
        INVALID_SELECTION: 400,
        UNSAFE_NOTEBOOK_PATH: 400,
        SELECTED_FILE_UNAVAILABLE: 404,
        FILE_TOO_LARGE: 413,
      }[error.code] || 500
      send(res, status, {
        error: { code: error.code || 'SYSTEM_OPERATION_FAILED', message: error.message || String(error) },
      })
    }
  }
}

export { pickWithAppleScript }
