import { getServerUrl } from './serverUrl.js'

export async function requestTerminalContext(request) {
  const response = await fetch(`${getServerUrl()}/_storyboard/canvas/terminal/context`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(10_000),
  })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.error || 'Terminal context request failed')
  return result
}

export async function handleTerminalContext() {
  try {
    const args = process.argv.slice(4)
    if (args.includes('--help')) {
      console.log('storyboard terminal context [--widget <id>] [--action state|start|exit|ack|retry] [--ack <revision> | --retry] [--revision <revision>] [--launch <id>] [--interactive true|false]')
      return
    }
    const values = {}
    for (let index = 0; index < args.length; index++) {
      const flag = args[index]
      if (!['--widget', '--action', '--ack', '--retry', '--revision', '--launch', '--interactive'].includes(flag)) throw new Error(`Unknown terminal context option ${flag}`)
      if (flag === '--retry') { values.retry = true; continue }
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
      values[flag.slice(2)] = value
    }
    if (values.interactive && !['true', 'false'].includes(values.interactive)) throw new Error('--interactive must be true or false')
    const result = await requestTerminalContext({
      widgetId: values.widget || process.env.STORYBOARD_WIDGET_ID,
      action: values.ack ? 'ack' : values.retry ? 'retry' : values.action || 'state',
      revision: values.ack || values.revision,
      launchId: values.launch || process.env.STORYBOARD_CONTEXT_LAUNCH_ID,
      ...(values.interactive ? { interactive: values.interactive === 'true' } : {}),
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exitCode = 1
  }
}
