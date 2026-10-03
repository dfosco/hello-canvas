/**
 * WidgetArtifactDialog — pick an artifact (prototype/story/story-set) BEFORE
 * adding a widget to the canvas.
 *
 * The previous flow added an empty widget with internal selection UI, which was
 * awful (esp. for prototypes) and led to component widgets being added with
 * no `storyId`. This dialog forces selection up front, then dispatches
 * `storyboard:canvas:add-widget` with full props.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import Dialog from '../Dialog.jsx'
import { buildPrototypeIndex, listStories, getStoryData } from '../../core/index.js'
import './WidgetArtifactDialog.css'

function formatName(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const TYPE_LABELS = {
  'prototype': 'Pick a prototype',
  'story': 'Pick a component',
  'component-set': 'Pick a component set',
}

const TYPE_SUBTITLES = {
  'prototype': 'Choose a prototype route, or enter a custom URL.',
  'story': 'Choose a story to embed on the canvas.',
  'component-set': 'Choose a story to render all its exports as a grid.',
}

function dispatchAddWidget(type, props) {
  document.dispatchEvent(new CustomEvent('storyboard:canvas:add-widget', {
    detail: { type, props },
  }))
}

function buildPrototypeGroups() {
  let idx
  try { idx = buildPrototypeIndex() }
  catch { return [] }
  const out = []
  const allProtos = []
  for (const folder of (idx.sorted?.title?.folders || idx.folders || [])) {
    for (const proto of folder.prototypes || []) {
      if (!proto.isExternal) allProtos.push(proto)
    }
  }
  for (const proto of (idx.sorted?.title?.prototypes || idx.prototypes || [])) {
    if (!proto.isExternal) allProtos.push(proto)
  }
  for (const proto of allProtos) {
    if (proto.hideFlows && proto.flows.length === 1) {
      out.push({ label: proto.name, items: [{ name: proto.name, route: proto.flows[0].route }] })
    } else if (proto.flows.length > 0) {
      out.push({ label: proto.name, items: proto.flows.map((f) => ({ name: f.meta?.title || formatName(f.name), route: f.route })) })
    } else {
      out.push({ label: proto.name, items: [{ name: proto.name, route: `/${proto.dirName}` }] })
    }
  }
  const gf = idx.globalFlows || []
  if (gf.length > 0) {
    out.push({ label: 'Other flows', items: gf.map((f) => ({ name: f.meta?.title || formatName(f.name), route: f.route })) })
  }
  return out
}

function buildStoryList() {
  let names = []
  try { names = listStories() } catch { return [] }
  return names
    .map((name) => {
      const data = getStoryData(name) || {}
      const exportNames = Array.isArray(data._exportNames) ? data._exportNames : []
      return { name, route: data._route || '', module: data._storyModule || '', exportNames }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function PrototypePicker({ onPick, onClose }) {
  const [filter, setFilter] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const filterRef = useRef(null)

  useEffect(() => {
    filterRef.current?.focus()
  }, [])

  const groups = useMemo(() => buildPrototypeGroups(), [])

  const filteredGroups = useMemo(() => {
    if (!filter) return groups
    const q = filter.toLowerCase()
    return groups
      .map((group) => {
        if (group.label.toLowerCase().includes(q)) return group
        const items = group.items.filter((i) => i.name.toLowerCase().includes(q) || i.route.toLowerCase().includes(q))
        return items.length ? { ...group, items } : null
      })
      .filter(Boolean)
  }, [groups, filter])

  function pickRoute(route, label) {
    onPick({ src: route, label: label || '' })
  }

  function submitCustom(e) {
    e.preventDefault()
    const v = customUrl.trim()
    if (!v) return
    pickRoute(v, '')
  }

  return (
    <div className="sb-wad-body">
      <input
        ref={filterRef}
        className="sb-wad-filter"
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter prototypes…"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      />
      <div className="sb-wad-list" role="listbox">
        {filteredGroups.map((group) => (
          <div key={group.label} className="sb-wad-group">
            {group.items.length === 1 && group.items[0].name === group.label ? (
              <button type="button" className="sb-wad-item" role="option" onClick={() => pickRoute(group.items[0].route, group.label)}>
                {group.label}
              </button>
            ) : (
              <>
                <div className="sb-wad-group-label">{group.label}</div>
                {group.items.map((item) => (
                  <button key={item.route} type="button" className="sb-wad-item sb-wad-item-nested" role="option" onClick={() => pickRoute(item.route, `${group.label} · ${item.name}`)}>
                    {item.name}
                  </button>
                ))}
              </>
            )}
          </div>
        ))}
        {filteredGroups.length === 0 && <div className="sb-wad-empty">No matches</div>}
      </div>
      <form className="sb-wad-custom" onSubmit={submitCustom}>
        <label className="sb-wad-custom-label">Or enter a custom URL</label>
        <div className="sb-wad-custom-row">
          <input
            type="text"
            className="sb-wad-custom-input"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="/MyPrototype/page"
          />
          <button type="submit" className="sb-wad-submit" disabled={!customUrl.trim()}>Add</button>
        </div>
      </form>
    </div>
  )
}

function StoryPicker({ type, onPick, onClose }) {
  const [filter, setFilter] = useState('')
  const filterRef = useRef(null)

  useEffect(() => { filterRef.current?.focus() }, [])

  const stories = useMemo(() => buildStoryList(), [])

  const filtered = useMemo(() => {
    if (!filter) return stories
    const q = filter.toLowerCase()
    return stories.filter((s) => s.name.toLowerCase().includes(q) || s.route.toLowerCase().includes(q))
  }, [stories, filter])

  function pick(story) {
    if (type === 'component-set') {
      onPick({ type: 'component-set', storyId: story.name, layout: 'auto', selected: '' })
      return
    }
    // For "story" picker (Add component to canvas), default to a component-set
    // when the story exposes multiple named exports; fall back to a single
    // component widget for stories with a single export.
    if (story.exportNames && story.exportNames.length > 1) {
      onPick({ type: 'component-set', storyId: story.name, layout: 'auto', selected: '' })
    } else {
      onPick({ type: 'story', storyId: story.name, exportName: '' })
    }
  }

  return (
    <div className="sb-wad-body">
      <input
        ref={filterRef}
        className="sb-wad-filter"
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter stories…"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      />
      <div className="sb-wad-list" role="listbox">
        {filtered.map((s) => {
          const count = s.exportNames?.length || 0
          const typeLabel = count > 1 ? `Component set · ${count} variants` : 'Component'
          return (
            <button key={s.name} type="button" className="sb-wad-item" role="option" onClick={() => pick(s)}>
              <span className="sb-wad-item-title">{s.name}</span>
              <span className="sb-wad-item-hint">{typeLabel}</span>
            </button>
          )
        })}
        {filtered.length === 0 && <div className="sb-wad-empty">No matches</div>}
      </div>
    </div>
  )
}

export default function WidgetArtifactDialog({ type, onClose }) {
  if (!type) return null
  const isPrototype = type === 'prototype'
  const title = type === 'story' ? 'Add component' : (TYPE_LABELS[type] || 'Pick an artifact')
  const subtitle = TYPE_SUBTITLES[type] || ''

  function handlePick(payload) {
    // StoryPicker may upgrade a `story` selection to a `component-set` when the
    // story has multiple exports. Honor the type returned in the payload.
    const { type: chosenType, ...props } = payload || {}
    dispatchAddWidget(chosenType || type, props)
    onClose?.()
  }

  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      width="large"
      height="large"
    >
      {isPrototype
        ? <PrototypePicker onPick={(props) => handlePick({ type: 'prototype', ...props })} onClose={onClose} />
        : <StoryPicker type={type} onPick={handlePick} onClose={onClose} />}
    </Dialog>
  )
}
