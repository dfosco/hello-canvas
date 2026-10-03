/** PTY logs are a byte stream; render control sequences as plain readable text. */
export function formatSiteTerminalOutput(logs = []) {
  const text = (Array.isArray(logs) ? logs : [])
    .map(entry => typeof entry?.message === 'string' ? entry.message : '')
    .filter(message => message.trim())
    .join('\n')
  // Paseo may hand us either full ANSI escapes or CSI fragments without ESC.
  // Strip these only after joining the stream so codes split across writes work.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\].*?(?:\x07|\x1b\\)|\[(?:\d{1,3};?){1,6}m/g, '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')
}
