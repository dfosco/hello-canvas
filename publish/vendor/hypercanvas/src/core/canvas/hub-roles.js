import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROLES_DIR = '.agents/roles'

const FALLBACK_ROLES = [
  { id: 'leader', title: 'Leader', type: 'unique', default: false, file: '.agents/roles/leader.role.md' },
  { id: 'member', title: 'Member', type: 'shared', default: true, file: '.agents/roles/member.role.md' },
]

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return {}
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return {}
  const block = raw.slice(3, end).trim()
  const meta = {}
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const valueRaw = line.slice(idx + 1).trim()
    if (!key) continue
    if (valueRaw === 'true') meta[key] = true
    else if (valueRaw === 'false') meta[key] = false
    else meta[key] = valueRaw.replace(/^['"]|['"]$/g, '')
  }
  return meta
}

export function listHubRoles(rootDir) {
  const dir = join(rootDir, ROLES_DIR)
  if (!existsSync(dir)) return FALLBACK_ROLES

  const files = readdirSync(dir).filter((f) => f.endsWith('.role.md'))
  if (files.length === 0) return FALLBACK_ROLES

  const roles = []
  for (const file of files) {
    const id = file.replace(/\.role\.md$/, '')
    try {
      const raw = readFileSync(join(dir, file), 'utf8')
      const meta = parseFrontmatter(raw)
      // Skip transient roles (e.g. starter) — they're auto-assigned, not user-selectable
      if (meta.transient === true) continue
      const type = meta.type === 'unique' ? 'unique' : 'shared'
      roles.push({
        id,
        title: meta.title || id,
        type,
        default: meta.default === true,
        file: `.agents/roles/${file}`,
      })
    } catch {
      roles.push({ id, title: id, type: 'shared', default: false, file: `.agents/roles/${file}` })
    }
  }

  if (!roles.some((r) => r.default)) {
    const member = roles.find((r) => r.id === 'member')
    if (member) member.default = true
    else roles[0].default = true
  }

  return roles.sort((a, b) => a.id.localeCompare(b.id))
}

export function getDefaultRoleId(roles) {
  return roles.find((r) => r.default)?.id || 'member'
}

