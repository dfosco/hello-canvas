import { GitBranchIcon } from '@primer/octicons-react'
import { Menu } from '@base-ui/react/menu'
import { buildBranchArtifactHref } from '../../core/data/artifactIndex.js'
import css from './BranchesDropdown.module.css'

function isLocalDev() {
  return typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true
}

function entryTitle(entry) {
  return entry?.title || entry?.name || ''
}

function branchLabel(entry, homeTitle, homeFolder) {
  const title = entryTitle(entry)
  const pieces = [entry.branch]
  if (title && title !== homeTitle) pieces.push(`— ${title}`)
  if (entry.folderName && entry.folderName !== (homeFolder || '')) pieces.push(`· ${entry.folderName}`)
  return pieces.join(' ')
}

export default function BranchesDropdown({ branches, branchBasePath, currentBranch, homeTitle = '', homeFolder = null, isBranchOnly = false }) {
  if (!currentBranch || isLocalDev() || !Array.isArray(branches)) return null

  const visibleBranches = branches.filter(entry => entry?.branch && entry.branch !== currentBranch)
  if (visibleBranches.length === 0) return null

  // When the prototype is branch-only (i.e. the current branch doesn't
  // have it), give the button a subtle accent so users can spot the
  // affordance without painting the whole card. Tooltip text shifts to
  // make the meaning explicit.
  const btnClass = isBranchOnly ? `${css.iconBtn} ${css.iconBtnAccent}` : css.iconBtn
  const label = isBranchOnly
    ? 'Open on another branch'
    : 'See branches'

  return (
    <Menu.Root>
      <Menu.Trigger
        className={btnClass}
        onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
        aria-label={label}
        title={label}
      >
        <GitBranchIcon size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className={css.branchesPositioner} side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className={css.branchesPopup}>
            <div className={css.branchesTitle}>
              {isBranchOnly ? 'Available on' : 'Branches'}
            </div>
            {visibleBranches.map(entry => {
              const href = entry.isExternal && entry.externalUrl
                ? entry.externalUrl
                : buildBranchArtifactHref(branchBasePath, entry.folder, entry.route)

              return (
                <Menu.Item
                  key={`${entry.branch}:${entry.folder || ''}:${entry.route || entry.externalUrl || ''}`}
                  className={css.branchesItem}
                >
                  <a
                    href={href}
                    className={css.branchesItemLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className={css.branchItemLabel}>{branchLabel(entry, homeTitle, homeFolder)}</span>
                    {entry.isExternal && <span className={css.externalIndicator} aria-label="External">↗</span>}
                  </a>
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
