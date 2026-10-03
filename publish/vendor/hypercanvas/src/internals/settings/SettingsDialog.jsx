/**
 * SettingsDialog — Tabbed settings dialog for storyboard.config.json.
 *
 * Loads config from the dev-server API, renders typed form fields for every
 * StoryboardConfig domain, and persists changes back to disk.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { MarkGithubIcon, TrashIcon, PlusIcon } from '@primer/octicons-react'
import { getAllFlags, setFlag as setRuntimeFlag } from '../../core/stores/featureFlags.js'
import {
  ToggleField,
  TextField,
  NumberField,
  SelectField,
  JsonField,
  SectionHeader,
  FieldGroup,
} from './FormFields.jsx'
import css from './SettingsDialog.module.css'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'terminal', label: 'Terminal & Agents' },
  { id: 'theming', label: 'Theming' },
  { id: 'customerMode', label: 'Customer Mode' },
  { id: 'featureFlags', label: 'Feature Flags' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'workshop', label: 'Workshop' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'comments', label: 'Comments' },
  { id: 'commandPalette', label: 'Command Palette' },
  { id: 'widgets', label: 'Widgets' },
]

async function fetchConfig() {
  const res = await fetch(`${import.meta.env.BASE_URL}_storyboard/config`)
  if (!res.ok) throw new Error('Failed to load config')
  return res.json()
}

async function saveConfig(updates) {
  const res = await fetch(`${import.meta.env.BASE_URL}_storyboard/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  })
  if (!res.ok) throw new Error('Failed to save config')
  return res.json()
}

export default function SettingsDialog({ open, onOpenChange, user, onRemoveToken }) {
  const [activeTab, setActiveTab] = useState('general')
  const [original, setOriginal] = useState(null)
  const [edits, setEdits] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    fetchConfig()
      .then(({ config }) => {
        setOriginal(config)
        setEdits({})
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [open])

  const setField = useCallback((path, value) => {
    setEdits(prev => ({ ...prev, [path]: value }))
  }, [])

  const getValue = useCallback((path) => {
    if (path in edits) return edits[path]
    // Traverse dot-path into original config
    const parts = path.split('.')
    let val = original
    for (const p of parts) {
      if (val == null) return undefined
      val = val[p]
    }
    return val
  }, [edits, original])

  const hasChanges = Object.keys(edits).length > 0

  const handleSave = useCallback(async () => {
    if (!hasChanges) return
    setSaving(true)
    setError(null)
    try {
      const result = await saveConfig(edits)
      setOriginal(result.config)
      setEdits({})
      // The Vite watcher reloads the virtual config module after this write.
      // Avoid reinitializing the store here because that would discard
      // prototype-local overrides before the reload completes.
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [edits, hasChanges])

  const handleCancel = useCallback(() => {
    setEdits({})
    setError(null)
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={css.settingsBackdrop} />
        <div className={css.settingsPopupWrap}>
          <Dialog.Popup className={css.settingsPopup}>
            <div className={css.settingsTitleBar}>
              <Dialog.Title className={css.settingsTitle}>Settings</Dialog.Title>
              <Dialog.Close className={css.settingsCloseBtn} aria-label="Close">&times;</Dialog.Close>
            </div>

            {loading ? (
              <div className={css.tabContent}><p>Loading configuration...</p></div>
            ) : (
              <>
                <div className={css.settingsBody}>
                  <nav className={css.tabSidebar}>
                    {TABS.map(tab => (
                      <button
                        key={tab.id}
                        className={`${css.tabButton} ${activeTab === tab.id ? css.tabButtonActive : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </nav>
                  <div className={css.tabContent}>
                    {activeTab === 'general' && <GeneralTab getValue={getValue} setField={setField} />}
                    {activeTab === 'canvas' && <CanvasTab getValue={getValue} setField={setField} />}
                    {activeTab === 'terminal' && <TerminalTab getValue={getValue} setField={setField} />}
                    {activeTab === 'theming' && <ThemingTab getValue={getValue} setField={setField} />}
                    {activeTab === 'customerMode' && <CustomerModeTab getValue={getValue} setField={setField} />}
                    {activeTab === 'featureFlags' && <FeatureFlagsTab getValue={getValue} setField={setField} />}
                    {activeTab === 'plugins' && <PluginsTab getValue={getValue} setField={setField} />}
                    {activeTab === 'workshop' && <WorkshopTab getValue={getValue} setField={setField} />}
                    {activeTab === 'navigation' && <NavigationTab getValue={getValue} setField={setField} />}
                    {activeTab === 'comments' && <CommentsTab getValue={getValue} setField={setField} user={user} onRemoveToken={onRemoveToken} onOpenChange={onOpenChange} />}
                    {activeTab === 'commandPalette' && <CommandPaletteTab getValue={getValue} setField={setField} />}
                    {activeTab === 'widgets' && <WidgetsTab getValue={getValue} setField={setField} />}
                  </div>
                </div>
                <div className={css.settingsFooter}>
                  {error && <span className={css.settingsError}>{error}</span>}
                  <button className={css.footerBtn} onClick={handleCancel}>Cancel</button>
                  <button
                    className={`${css.footerBtn} ${css.footerBtnPrimary}`}
                    onClick={handleSave}
                    disabled={!hasChanges || saving}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ─── Tab Panels ─── */

function GeneralTab({ getValue, setField }) {
  return (
    <>
      <FieldGroup>
        <SectionHeader>Identity</SectionHeader>
        <TextField label="Custom Domain" description="Local dev hostname (e.g. myapp.localhost)" value={getValue('customDomain')} onChange={v => setField('customDomain', v)} placeholder="myapp.localhost" />
        <TextField label="Production Domain" description="Deployed host, e.g. user.github.io/repo/" value={getValue('prodDomain')} onChange={v => setField('prodDomain', v)} placeholder="user.github.io/repo/" />
        <NumberField label="Port" description="Fixed dev server port (0 = auto)" value={getValue('port')} onChange={v => setField('port', v)} min={0} max={65535} step={1} />
        <TextField label="Dev Domain Color" description="CSS color for the BranchBar in local dev" value={getValue('devDomainColor')} onChange={v => setField('devDomainColor', v)} placeholder="#3b82f6" />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Repository</SectionHeader>
        <TextField label="Owner" description="GitHub owner or org" value={getValue('repository.owner')} onChange={v => setField('repository.owner', v)} placeholder="octocat" />
        <TextField label="Name" description="GitHub repository name" value={getValue('repository.name')} onChange={v => setField('repository.name', v)} placeholder="my-repo" />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Modes</SectionHeader>
        <ToggleField label="Enable Modes" description="Show the mode switcher (Navigate, Develop, Collaborate, Canvas)" value={getValue('modes.enabled')} onChange={v => setField('modes.enabled', v)} />
      </FieldGroup>
    </>
  )
}

function CanvasTab({ getValue, setField }) {
  return (
    <>
      <FieldGroup>
        <SectionHeader>Zoom</SectionHeader>
        <NumberField label="Min Zoom" description="Minimum zoom level (%)" value={getValue('canvas.zoom.min')} onChange={v => setField('canvas.zoom.min', v)} min={1} max={100} step={1} />
        <NumberField label="Max Zoom" description="Maximum zoom level (%)" value={getValue('canvas.zoom.max')} onChange={v => setField('canvas.zoom.max', v)} min={100} max={1000} step={10} />
        <NumberField label="Step" description="Zoom step size (%)" value={getValue('canvas.zoom.step')} onChange={v => setField('canvas.zoom.step', v)} min={1} max={50} step={1} />
        <ToggleField label="Gestures" description="Enable cmd+wheel and pinch-to-zoom" value={getValue('canvas.zoom.gestures')} onChange={v => setField('canvas.zoom.gestures', v)} />
        <SelectField label="Origin" description="Anchor point for zoom" value={getValue('canvas.zoom.origin')} onChange={v => setField('canvas.zoom.origin', v)} options={[{ value: 'center', label: 'Center' }, { value: 'top-left', label: 'Top Left' }]} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Scroll</SectionHeader>
        <SelectField label="Axis" description="Allowed scroll axes" value={getValue('canvas.scroll.axis')} onChange={v => setField('canvas.scroll.axis', v)} options={[{ value: 'both', label: 'Both' }, { value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }, { value: 'none', label: 'None' }]} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Surface</SectionHeader>
        <SelectField label="Width" description="Canvas surface width" value={getValue('canvas.surface.width')} onChange={v => setField('canvas.surface.width', v)} options={[{ value: 'auto', label: 'Auto' }, { value: 'viewport', label: 'Viewport' }]} />
        <SelectField label="Height" description="Canvas surface height" value={getValue('canvas.surface.height')} onChange={v => setField('canvas.surface.height', v)} options={[{ value: 'auto', label: 'Auto' }, { value: 'viewport', label: 'Viewport' }]} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>GitHub Embeds</SectionHeader>
        <SelectField label="Embed Behavior" description="How GitHub URLs are rendered on canvas" value={getValue('canvas.github.embedBehavior')} onChange={v => setField('canvas.github.embedBehavior', v)} options={[{ value: 'link-preview', label: 'Link Preview' }, { value: 'rich-embed', label: 'Rich Embed' }]} />
        <SelectField label="GH Guard" description="Guard behavior for GitHub links" value={getValue('canvas.github.ghGuard')} onChange={v => setField('canvas.github.ghGuard', v)} options={[{ value: 'copy', label: 'Copy' }, { value: 'link', label: 'Link' }, { value: 'off', label: 'Off' }]} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>File Editor</SectionHeader>
        <TextField label="Light Theme" description="CodeMirror theme for light mode" value={getValue('canvas.fileEditor.theme.light')} onChange={v => setField('canvas.fileEditor.theme.light', v)} placeholder="default" />
        <TextField label="Dark Theme" description="CodeMirror theme for dark mode" value={getValue('canvas.fileEditor.theme.dark')} onChange={v => setField('canvas.fileEditor.theme.dark', v)} placeholder="oneDark" />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Production Interactions</SectionHeader>
        <ToggleField label="Allow Move" description="Allow moving widgets in production" value={getValue('canvas.production.move')} onChange={v => setField('canvas.production.move', v)} />
        <ToggleField label="Allow Resize" description="Allow resizing widgets in production" value={getValue('canvas.production.resize')} onChange={v => setField('canvas.production.resize', v)} />
        <ToggleField label="Allow Markdown Edit" description="Allow editing markdown in production" value={getValue('canvas.production.editMarkdown')} onChange={v => setField('canvas.production.editMarkdown', v)} />
        <ToggleField label="Allow Sticky Edit" description="Allow editing sticky notes in production" value={getValue('canvas.production.editSticky')} onChange={v => setField('canvas.production.editSticky', v)} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Paste Rules</SectionHeader>
        <JsonField label="Paste Rules" description="Rules for pasting URLs onto canvas" value={getValue('canvas.pasteRules')} onChange={v => setField('canvas.pasteRules', v)} />
      </FieldGroup>
    </>
  )
}

function TerminalTab({ getValue, setField }) {
  return (
    <>
      <FieldGroup>
        <SectionHeader>Terminal Defaults</SectionHeader>
        <ToggleField label="Resizable" description="Allow terminal widget resizing" value={getValue('canvas.terminal.resizable')} onChange={v => setField('canvas.terminal.resizable', v)} />
        <NumberField label="Default Width" description="Terminal widget width (px)" value={getValue('canvas.terminal.defaultWidth')} onChange={v => setField('canvas.terminal.defaultWidth', v)} min={200} max={2000} step={50} />
        <NumberField label="Default Height" description="Terminal widget height (px)" value={getValue('canvas.terminal.defaultHeight')} onChange={v => setField('canvas.terminal.defaultHeight', v)} min={200} max={2000} step={50} />
        <NumberField label="Font Size" description="Terminal font size (px)" value={getValue('canvas.terminal.fontSize')} onChange={v => setField('canvas.terminal.fontSize', v)} min={8} max={32} step={1} />
        <TextField label="Font Family" description="Terminal CSS font-family" value={getValue('canvas.terminal.fontFamily')} onChange={v => setField('canvas.terminal.fontFamily', v)} placeholder="monospace" />
        <TextField label="Prompt" description="Shell prompt string" value={getValue('canvas.terminal.prompt')} onChange={v => setField('canvas.terminal.prompt', v)} placeholder="$ " />
        <TextField label="Startup Command" description="Command to run when a terminal opens" value={getValue('canvas.terminal.startupCommand')} onChange={v => setField('canvas.terminal.startupCommand', v)} placeholder="shell" />
        <JsonField label="Default Startup Sequence" description="Steps to run after a terminal opens" value={getValue('canvas.terminal.defaultStartupSequence')} onChange={v => setField('canvas.terminal.defaultStartupSequence', v)} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Hot Pool</SectionHeader>
        <ToggleField label="Enabled" description="Pre-warm agent sessions for faster startup" value={getValue('hotPool.enabled')} onChange={v => setField('hotPool.enabled', v)} />
        {(() => { const poolOn = getValue('hotPool.enabled') !== false; return <>
        <ToggleField label="Verbose" description="Log hot pool activity" value={getValue('hotPool.verbose')} onChange={v => setField('hotPool.verbose', v)} disabled={!poolOn} />
        <NumberField label="Pool Size" description="Number of pre-warmed sessions" value={getValue('hotPool.default_pool_size')} onChange={v => setField('hotPool.default_pool_size', v)} min={0} max={20} step={1} disabled={!poolOn} />
        <NumberField label="Max Pool Size" description="Maximum pool size" value={getValue('hotPool.default_max_pool_size')} onChange={v => setField('hotPool.default_max_pool_size', v)} min={0} max={50} step={1} disabled={!poolOn} />
        <ToggleField label="Load Balancer" description="Automatically scale pools to demand" value={getValue('hotPool.load_balancer')} onChange={v => setField('hotPool.load_balancer', v)} disabled={!poolOn} />
        <NumberField label="Scale-down Cooldown" description="Minutes idle before the pool scales down" value={getValue('hotPool.load_balancer_cooldown_mins')} onChange={v => setField('hotPool.load_balancer_cooldown_mins', v)} min={0} max={120} step={1} disabled={!poolOn} />
        <JsonField label="Pool Overrides" description="Per-agent pool_size and max_pool_size overrides" value={getValue('hotPool.pools')} onChange={v => setField('hotPool.pools', v)} disabled={!poolOn} />
        </> })()}
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Canvas Agents</SectionHeader>
        <JsonField label="Agent Configs" description="Agent definitions (label, icon, startupCommand, etc.)" value={getValue('canvas.agents')} onChange={v => setField('canvas.agents', v)} />
      </FieldGroup>
    </>
  )
}

function ThemingTab({ getValue, setField }) {
  return (
    <>
      <FieldGroup>
        <SectionHeader>Global</SectionHeader>
        <SelectField label="Default Theme" description="Default theme applied on first visit" value={getValue('theming.default')} onChange={v => setField('theming.default', v)} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Themes</SectionHeader>
        <JsonField label="Theme Definitions" description="Map of theme ID to { label, attrs }" value={getValue('theming.themes')} onChange={v => setField('theming.themes', v)} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Surfaces</SectionHeader>
        <JsonField label="Surface Definitions" description="Map of surface ID to { label, sync }" value={getValue('theming.surfaces')} onChange={v => setField('theming.surfaces', v)} />
      </FieldGroup>
    </>
  )
}

function CustomerModeTab({ getValue, setField }) {
  return (
    <>
      <FieldGroup>
        <SectionHeader>Customer Mode</SectionHeader>
        <ToggleField label="Enabled" description="Enable customer/participant mode" value={getValue('customerMode.enabled')} onChange={v => setField('customerMode.enabled', v)} />
        <TextField label="Homepage" description="Custom homepage route (true/false/string)" value={String(getValue('customerMode.homepage') ?? 'false')} onChange={v => {
          const parsed = v === 'true' ? true : v === 'false' ? false : v
          setField('customerMode.homepage', parsed)
        }} placeholder="false" />
        <JsonField label="Tools" description="Toolbar visibility: all, none, { hide: [...] }, or { only: [...] }" value={getValue('customerMode.tools')} onChange={v => setField('customerMode.tools', v)} />
        <ToggleField label="Command Palette" description="Show command palette in customer mode" value={getValue('customerMode.commandPalette')} onChange={v => setField('customerMode.commandPalette', v)} />
        <ToggleField label="Branch Bar" description="Show branch bar in customer mode" value={getValue('customerMode.branchBar')} onChange={v => setField('customerMode.branchBar', v)} />
        <ToggleField label="Legacy: Hide Chrome" description="Deprecated alias for hiding toolbar, palette, and branch bar" value={getValue('customerMode.hideChrome')} onChange={v => setField('customerMode.hideChrome', v)} />
        <ToggleField label="Legacy: Hide Homepage" description="Deprecated alias for an empty homepage" value={getValue('customerMode.hideHomepage')} onChange={v => setField('customerMode.hideHomepage', v)} />
        <TextField label="Legacy: Prototype Homepage" description="Deprecated prototype homepage path" value={getValue('customerMode.protoHomepage')} onChange={v => setField('customerMode.protoHomepage', v)} />
        <TextField label="Legacy: Canvas Homepage" description="Deprecated canvas homepage ID" value={getValue('customerMode.canvasHomepage')} onChange={v => setField('customerMode.canvasHomepage', v)} />
      </FieldGroup>
    </>
  )
}

function PluginsTab({ getValue, setField }) {
  return (
    <FieldGroup>
      <SectionHeader>Plugins</SectionHeader>
      <JsonField label="Plugins" description="Map of plugin name to enabled (true/false)" value={getValue('plugins')} onChange={v => setField('plugins', v)} />
    </FieldGroup>
  )
}

function FeatureFlagsTab({ getValue, setField }) {
  const [newFlagName, setNewFlagName] = useState('')
  const [flags, setFlags] = useState(() => getAllFlags())

  const refreshFlags = useCallback(() => setFlags(getAllFlags()), [])
  const configFlags = useMemo(() => getValue('featureFlags') || {}, [getValue])

  const handleToggle = useCallback((key) => {
    const current = flags[key]?.current ?? false
    setRuntimeFlag(key, !current)
    refreshFlags()
  }, [flags, refreshFlags])

  const handleAdd = useCallback(() => {
    const key = newFlagName.trim()
    if (!key || key === 'usePaseoApp') return
    if (key in flags) return
    setField('featureFlags', { ...configFlags, [key]: false })
    setRuntimeFlag(key, false)
    setNewFlagName('')
    refreshFlags()
  }, [newFlagName, flags, configFlags, setField, refreshFlags])

  const handleRemove = useCallback((key) => {
    const next = { ...configFlags }
    delete next[key]
    setField('featureFlags', next)
    refreshFlags()
  }, [configFlags, setField, refreshFlags])

  // Daemon selection is persisted server-side and only applied at app startup.
  // It must not use the ordinary browser-local, immediately active toggles.
  const flagEntries = Object.entries(flags).filter(([key]) => key !== 'usePaseoApp')

  return (
    <FieldGroup>
      <SectionHeader>Feature Flags</SectionHeader>
      <ToggleField
        label="usePaseoApp"
        description="Prefer the running Paseo App daemon; otherwise use a private daemon. Turn off to always use private. Save, then restart Hypercanvas to apply (not just the browser)."
        value={configFlags.usePaseoApp ?? true}
        onChange={value => setField('featureFlags', { ...configFlags, usePaseoApp: value })}
      />
      {flagEntries.length === 0 && (
        <p className={css.fieldDesc}>No live feature flags defined. Add one below.</p>
      )}
      {flagEntries.map(([key, { current }]) => (
        <label key={key} className={css.flagRow}>
          <div className={css.flagInfo}>
            <span className={css.flagKey}>{key}</span>
            {key in configFlags && <span className={css.flagSource}>config</span>}
            {!(key in configFlags) && <span className={css.flagSourceMuted}>runtime</span>}
          </div>
          <div className={css.flagActions}>
            <button
              type="button"
              className={`${css.toggle} ${current ? css.toggleOn : ''}`}
              onClick={() => handleToggle(key)}
              role="switch"
              aria-checked={current}
            >
              <span className={css.toggleKnob} />
            </button>
            {key in configFlags && (
              <button className={css.flagRemoveBtn} onClick={() => handleRemove(key)} title="Remove from config">
                <TrashIcon size={14} />
              </button>
            )}
          </div>
        </label>
      ))}
      <div className={css.flagAddRow}>
        <input
          className={css.fieldInput}
          type="text"
          placeholder="new-flag-name"
          value={newFlagName}
          onChange={e => setNewFlagName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
        />
        <button className={css.flagAddBtn} onClick={handleAdd} disabled={!newFlagName.trim()}>
          <PlusIcon size={14} />
          Add
        </button>
      </div>
    </FieldGroup>
  )
}

function WorkshopTab({ getValue, setField }) {
  return (
    <>
      <FieldGroup>
        <SectionHeader>Workshop</SectionHeader>
        <ToggleField label="Enabled" description="Enable the Workshop creation menu" value={getValue('workshop.enabled')} onChange={v => setField('workshop.enabled', v)} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Features</SectionHeader>
        <ToggleField label="Create Prototype" description="Show Create Prototype in the Workshop menu" value={getValue('workshop.features.createPrototype')} onChange={v => setField('workshop.features.createPrototype', v)} />
        <ToggleField label="Create Canvas" description="Show Create Canvas in the Workshop menu" value={getValue('workshop.features.createCanvas')} onChange={v => setField('workshop.features.createCanvas', v)} />
        <ToggleField label="Create Component" description="Show Create Component in the Workshop menu" value={getValue('workshop.features.createComponent')} onChange={v => setField('workshop.features.createComponent', v)} />
        <ToggleField label="Create Flow" description="Show Create Flow in the Workshop menu" value={getValue('workshop.features.createFlow')} onChange={v => setField('workshop.features.createFlow', v)} />
        <ToggleField label="Create Page" description="Show Create Page in the Workshop menu" value={getValue('workshop.features.createPage')} onChange={v => setField('workshop.features.createPage', v)} />
        <ToggleField label="Create Object" description="Show Create Object in the Workshop menu" value={getValue('workshop.features.createObject')} onChange={v => setField('workshop.features.createObject', v)} />
        <ToggleField label="Create Record" description="Show Create Record in the Workshop menu" value={getValue('workshop.features.createRecord')} onChange={v => setField('workshop.features.createRecord', v)} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Partials</SectionHeader>
        <JsonField label="Partials" description="Custom partials for the Workshop" value={getValue('workshop.partials')} onChange={v => setField('workshop.partials', v)} />
      </FieldGroup>
    </>
  )
}

function NavigationTab({ getValue, setField }) {
  return (
    <>
      <FieldGroup>
        <SectionHeader>Routes</SectionHeader>
        <JsonField label="Routes" description="Map of path to target page (string or { dev, prod, default })" value={getValue('routes')} onChange={v => setField('routes', v)} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Home Page</SectionHeader>
        <TextField label="Title" description="Home page title" value={getValue('pages.home.title')} onChange={v => setField('pages.home.title', v)} />
        <TextField label="Subtitle" description="Home page subtitle" value={getValue('pages.home.subtitle')} onChange={v => setField('pages.home.subtitle', v)} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Workspace Page</SectionHeader>
        <TextField label="Title" description="Workspace page title" value={getValue('pages.workspace.title')} onChange={v => setField('pages.workspace.title', v)} />
        <TextField label="Subtitle" description="Workspace page subtitle" value={getValue('pages.workspace.subtitle')} onChange={v => setField('pages.workspace.subtitle', v)} />
        <TextField label="Logo" description="URL or path to logo image" value={getValue('pages.workspace.logo')} onChange={v => setField('pages.workspace.logo', v)} placeholder="null" />
        <TextField label="Logo Icon" description="Icon name for the workspace logo" value={getValue('pages.workspace.logoIcon')} onChange={v => setField('pages.workspace.logoIcon', v)} placeholder="iconoir/key-command" />
        <ToggleField label="Show All Artifacts" description="Show all artifacts tab" value={getValue('pages.workspace.showAllArtifacts')} onChange={v => setField('pages.workspace.showAllArtifacts', v)} />
        <ToggleField label="Show Prototypes" description="Show prototypes section" value={getValue('pages.workspace.showPrototypes')} onChange={v => setField('pages.workspace.showPrototypes', v)} />
        <ToggleField label="Show Canvases" description="Show canvases section" value={getValue('pages.workspace.showCanvases')} onChange={v => setField('pages.workspace.showCanvases', v)} />
        <ToggleField label="Show Components" description="Show components section" value={getValue('pages.workspace.showComponents')} onChange={v => setField('pages.workspace.showComponents', v)} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>UI</SectionHeader>
        <JsonField label="Hidden Items" description="Array of menu item IDs to hide" value={getValue('ui.hide')} onChange={v => setField('ui.hide', v)} />
        <JsonField label="Toolbar Overrides" description="Toolbar-specific configuration" value={getValue('toolbar')} onChange={v => setField('toolbar', v)} />
      </FieldGroup>
    </>
  )
}

function CommentsTab({ getValue, setField, user, onRemoveToken, onOpenChange }) {
  return (
    <>
      <FieldGroup>
        <SectionHeader>GitHub Discussions</SectionHeader>
        <TextField label="Discussion Category" description="GitHub Discussions category used for comments" value={getValue('comments.discussions.category')} onChange={v => setField('comments.discussions.category', v)} placeholder="Comments" />
      </FieldGroup>
      <CommentsConnection user={user} onRemoveToken={onRemoveToken} onOpenChange={onOpenChange} />
    </>
  )
}

function CommandPaletteTab({ getValue, setField }) {
  return (
    <>
      <FieldGroup>
        <SectionHeader>Command Palette</SectionHeader>
        <JsonField label="Providers" description="Array of data providers to search" value={getValue('commandPalette.providers')} onChange={v => setField('commandPalette.providers', v)} />
        <SelectField label="Ranking" description="Result ranking algorithm" value={getValue('commandPalette.ranking')} onChange={v => setField('commandPalette.ranking', v)} options={[{ value: 'frecency', label: 'Frecency' }, { value: 'alphabetical', label: 'Alphabetical' }]} />
      </FieldGroup>
      <FieldGroup>
        <SectionHeader>Custom Sections</SectionHeader>
        <JsonField label="Sections" description="Custom command palette sections" value={getValue('commandPalette.sections')} onChange={v => setField('commandPalette.sections', v)} />
      </FieldGroup>
    </>
  )
}

function WidgetsTab({ getValue, setField }) {
  return (
    <FieldGroup>
      <SectionHeader>Widget Overrides</SectionHeader>
      <JsonField label="Widgets" description="Map of widget type to metadata override (label, icon, chrome, props)" value={getValue('widgets')} onChange={v => setField('widgets', v)} />
    </FieldGroup>
  )
}

const COMMENTS_TOKEN_KEY = 'sb-comments-token'

function CommentsConnection({ user, onRemoveToken, onOpenChange }) {
  const hasToken = (() => {
    try { return !!localStorage.getItem(COMMENTS_TOKEN_KEY) } catch { return false }
  })()
  const scopes = user?.scopes || []
  const isFineGrained = hasToken && scopes.length === 0

  return (
    <FieldGroup>
      <SectionHeader>GitHub Comments Connection</SectionHeader>
      {hasToken ? (
        <div className={css.githubCard}>
          <div className={css.githubRow}>
            <span className={css.githubLabel}>Token</span>
            <code className={css.githubValue}>&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</code>
          </div>
          <div className={css.githubRow}>
            <span className={css.githubLabel}>Permissions</span>
            <span className={css.githubValue}>
              {isFineGrained
                ? 'Fine-grained token'
                : scopes.map(s => <code key={s} className={css.githubScope}>{s}</code>)
              }
            </span>
          </div>
          <button className={css.githubRemoveBtn} onClick={onRemoveToken}>
            <TrashIcon size={14} />
            Remove token
          </button>
        </div>
      ) : (
        <div className={css.githubNoToken}>
          <p>Connect GitHub only to read and post comments in GitHub Discussions.</p>
          <button
            className={css.githubSignInBtn}
            onClick={() => {
              onOpenChange(false)
              document.dispatchEvent(new CustomEvent('storyboard:open-auth-modal'))
            }}
          >
            <MarkGithubIcon size={16} />
            Connect GitHub for comments
          </button>
        </div>
      )}
    </FieldGroup>
  )
}
