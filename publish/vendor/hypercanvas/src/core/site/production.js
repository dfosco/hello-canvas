import fs from 'node:fs'
import path from 'node:path'
import { normalizeSiteUrl } from './site.js'

const CONFIGS = [
  ['vercel.json', 'Vercel'],
  ['netlify.toml', 'Netlify'],
  ['wrangler.toml', 'Cloudflare'],
]

export function discoverProductionSiteUrl(root) {
  const findings = []
  for (const [file, provider] of CONFIGS) {
    const filePath = path.join(path.resolve(root), file)
    if (!fs.existsSync(filePath)) continue
    const text = fs.readFileSync(filePath, 'utf8')
    const match = text.match(/["']?(?:url|domain|alias|route)["']?\s*[:=]\s*["']([^"']+)["']/i)
    if (match?.[1]) findings.push({ provider, config: file, baseUrl: normalizeSiteUrl(match[1], { label: `${provider} production URL` }) })
    else findings.push({ provider, config: file, baseUrl: null, needsInput: true })
  }
  return findings
}

export function confirmProductionSiteUrl({ candidate, provided, confirmed = false } = {}) {
  const value = provided || candidate
  if (!value) throw new Error('A production Site URL must be provided or discovered before publishing')
  if (!confirmed) throw new Error('Production Site URL requires explicit confirmation')
  return normalizeSiteUrl(value, { label: 'production Site URL' })
}
