const VERSION_PATTERN = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?=\s|$)/m

export function parseToolVersion(output) {
  return String(output || '').match(VERSION_PATTERN)?.[1] || null
}

function agent(definition) {
  return Object.freeze({
    ...definition,
    knownPaths: Object.freeze(definition.knownPaths),
    versionArgs: Object.freeze(definition.versionArgs),
    install: Object.freeze({
      ...definition.install,
      allowedFinalUrls: Object.freeze(definition.install.allowedFinalUrls),
      args: Object.freeze(definition.install.args),
      env: Object.freeze(definition.install.env),
    }),
  })
}

const INSTALLER_SCRIPT_INTEGRITY = 'No fixed checksum is published for this installer script. Its integrity is controlled by the vendor and HTTPS; downloaded release payload checks are performed only where the vendor installer implements them.'

const officialInstaller = ({
  origin,
  allowedFinalUrls,
  destination,
  args = [],
  env = {},
  modifiesShellProfile = false,
  profileControl,
  repairGuidance,
}) => ({
  channel: 'official-https-installer',
  origin,
  allowedFinalUrls,
  artifact: 'shell-script',
  shell: '/bin/bash',
  args,
  env,
  destination,
  pathDirectory: destination.slice(0, destination.lastIndexOf('/')),
  modifiesShellProfile,
  profileControl,
  authentication: 'user-managed',
  integrity: INSTALLER_SCRIPT_INTEGRITY,
  manualCommand: `Download ${origin} to a local file, then execute that file with /bin/bash.`,
  repairGuidance,
})

export const AGENT_CATALOG = Object.freeze([
  agent({
    id: 'codex',
    displayName: 'Codex',
    executable: 'codex',
    knownPaths: ['~/.local/bin/codex', '/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
    versionArgs: ['--version'],
    parseVersion: parseToolVersion,
    install: officialInstaller({
      origin: 'https://chatgpt.com/codex/install.sh',
      allowedFinalUrls: [
        'https://chatgpt.com/codex/install.sh',
        'https://releases.openai.com/codex/install.sh',
      ],
      destination: '~/.local/bin/codex',
      env: { CODEX_INSTALL_DIR: '~/.local/bin', CODEX_NON_INTERACTIVE: 'true' },
      profileControl: 'The destination is placed on PATH before execution so the installer does not offer or apply shell-profile changes.',
      repairGuidance: 'Re-run the official standalone installer, then verify ~/.local/bin/codex --version.',
    }),
  }),
  agent({
    id: 'claude',
    displayName: 'Claude',
    executable: 'claude',
    knownPaths: ['~/.local/bin/claude', '~/.claude/local/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
    versionArgs: ['--version'],
    parseVersion: parseToolVersion,
    install: officialInstaller({
      origin: 'https://claude.ai/install.sh',
      allowedFinalUrls: [
        'https://claude.ai/install.sh',
        'https://downloads.claude.ai/claude-code-releases/bootstrap.sh',
      ],
      destination: '~/.local/bin/claude',
      args: ['stable'],
      modifiesShellProfile: true,
      profileControl: 'The official native bootstrap controls launcher and shell integration. Hypercanvas discloses this vendor-managed change before consent and does not edit shell files itself.',
      repairGuidance: 'Re-run the official stable installer, then verify ~/.local/bin/claude --version.',
    }),
  }),
  agent({
    id: 'copilot',
    displayName: 'Copilot',
    executable: 'copilot',
    knownPaths: ['~/.local/bin/copilot', '/opt/homebrew/bin/copilot', '/usr/local/bin/copilot'],
    versionArgs: ['--version'],
    parseVersion: parseToolVersion,
    install: officialInstaller({
      origin: 'https://gh.io/copilot-install',
      allowedFinalUrls: [
        'https://gh.io/copilot-install',
        'https://raw.githubusercontent.com/github/copilot-cli/refs/heads/main/install.sh',
      ],
      destination: '~/.local/bin/copilot',
      env: { PREFIX: '~/.local' },
      profileControl: 'PREFIX and PATH are set by Hypercanvas so the non-interactive installer does not prompt to modify a shell profile.',
      repairGuidance: 'Re-run the official installer with PREFIX=$HOME/.local, then verify ~/.local/bin/copilot --version.',
    }),
  }),
  agent({
    id: 'opencode',
    displayName: 'OpenCode',
    executable: 'opencode',
    knownPaths: ['~/.opencode/bin/opencode', '~/.local/bin/opencode', '/opt/homebrew/bin/opencode', '/usr/local/bin/opencode'],
    versionArgs: ['--version'],
    parseVersion: parseToolVersion,
    install: officialInstaller({
      origin: 'https://opencode.ai/install',
      allowedFinalUrls: [
        'https://opencode.ai/install',
        'https://raw.githubusercontent.com/anomalyco/opencode/refs/heads/dev/install',
      ],
      destination: '~/.opencode/bin/opencode',
      args: ['--no-modify-path'],
      profileControl: 'The code-owned --no-modify-path option disables shell-profile changes.',
      repairGuidance: 'Re-run the official installer with --no-modify-path, then verify ~/.opencode/bin/opencode --version.',
    }),
  }),
])

export const AGENT_IDS = Object.freeze(AGENT_CATALOG.map(({ id }) => id))

export function getAgentDefinition(id) {
  return AGENT_CATALOG.find((entry) => entry.id === id) || null
}
