import { createPublishedSiteFrame } from './publish.js'

export function renderPublishedSiteFrame(frame) {
  const title = escapeHtml(frame?.title || frame?.siteId || 'Site')
  if (!frame?.snapshotUrl) return `<article class="site-frame site-frame--unavailable"><strong>${title}</strong><p>Preview unavailable.</p><a href="${escapeHtml(frame?.openUrl || '#')}">Open site</a></article>`
  return `<figure class="site-frame"><a href="${escapeHtml(frame.openUrl || '#')}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(frame.snapshotUrl)}" alt="${title}" loading="lazy"></a><figcaption>${title}</figcaption></figure>`
}

export function buildPublishedSiteManifest(references = [], options = {}) {
  return references.map(reference => createPublishedSiteFrame(reference, options[reference.siteId] ?? options))
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])) }
