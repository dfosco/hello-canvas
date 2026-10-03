---
name: hypercanvas-knobs
description: Author typed Hypercanvas knobs for prototypes, components, and canvas widgets. Use when asked to create knobs, tweakable prototype controls, Storybook-like controls, URL-backed variants, or a knobs panel/widget setup.
metadata:
  author: Daniel Fosco
  version: "2026.6.6"
---

# Skill: hypercanvas-knobs — Typed URL-backed controls

Knobs are typed configuration controls declared in JSON and consumed by prototypes, components, or canvas widgets. They give users a Storybook-like control surface, but values live in the URL hash so configurations are shareable by link.

> **Deep reference:** [`DOCS/knobs.md` on GitHub](https://github.com/dfosco/hypercanvas/blob/main/DOCS/knobs.md). When in doubt, that doc wins.

## Triggers

Invoke this skill when the user says:

- "add knobs", "create knobs", "make this tweakable"
- "add controls", "Storybook controls", "Storybook knobs"
- "let me change variants from the URL", "URL-backed settings"
- "add a knobs widget", "connect knobs to this prototype/component"
- "make a prototype-wide toggle", "make a route-scoped control"
- Any prompt mentioning `useKnob`, `KnobsForm`, `KnobsWidget`, `meta.knobs`, `.component.json`, or `widgets.<type>.knobs`

---

## Decision flow — where do knobs go?

| If the knob changes… | Declare it in… | Shape |
|---|---|---|
| A whole prototype or route inside it | `src/prototypes/**/[name].prototype.json` | `meta.knobs[]` |
| A reusable component or component story | `src/components/Name/Name.component.json` | top-level `knobs[]` |
| A custom canvas widget type | `widgets.config.json`, `storyboard.config.json`, or `mountStoryboardCore({ widgets })` | `widgets.<type>.knobs[]` |

Use knobs for reviewer/designer-facing variants, not content/model data. Keep content in `.flow.json`, `.object.json`, or `.record.json`. Keep form state and internal interaction state in `useOverride`.

Authoring steps:

1. Pick a camel-case `id` (`showSocial`, `accentHue`).
2. Pick one v1 `type` from the catalog.
3. Add `label`, `description`, and a type-correct `default`.
4. Add `scope: "/Route"` only if the knob is route-specific.
5. (Optional) Opt into the in-page highlight overlay with
   `knobMeta: { highlight: true, color: "#hex" }` — see
   [In-page highlight overlay](#in-page-highlight-overlay).
6. Consume the value with `useKnob(id)` or `useKnob(id, { route: '/Route' })`.
7. (When `highlight: true`) Sprinkle `data-knob-id="<id>"` on the DOM
   element the knob controls, so users can see exactly what they're
   tweaking.
8. Verify the toolbar panel or canvas widget updates the hash without iframe reloads.

---

## In-page highlight overlay

Some knobs control a specific element on the page and deserve a visible
pointer in the UI. Opt those knobs into the highlight overlay; leave it
off for everything else (theme toggles, layout tweaks, etc.).

**Opt in** by setting `knobMeta.highlight: true`:

```jsonc
{
  "id": "view",
  "type": "select",
  "label": "View",
  "options": ["a", "b"],
  "knobMeta": { "highlight": true, "color": "#ff8800" }
}
```

When the overlay is active (toolbar panel open in the top frame, OR
`?sb_knobs=1` in the iframe URL for canvas embeds with a connected Knobs
widget), every `[data-knob-id]` element whose id matches an opted-in
knob on the current prototype gets:

- a colored ring (color from `knobMeta.color`, default Primer blue `#0969da`)
- a top-left badge with the knob's `label`
- a matching colored dot to the **right** of the label in the panel

```jsx
function PublicMonitoring() {
  const view = useKnob('view')
  return <section data-knob-id="view">{view === 'a' ? <ViewA /> : <ViewB />}</section>
}
```

The lookup is route-scoped (route-specific knobs win over unscoped on id
collision) and limited to the current prototype.

### Picking a color

**When you opt a knob into `highlight: true`, also set a `color`** —
the default blue is fine for a single knob, but multiple highlighted
knobs on the same page will run together if they all share it. Pick a
visually distinct hex per knob, e.g.:

| knob ordinal | recommended color | hex |
|---|---|---|
| 1st | blue | `#0969da` |
| 2nd | amber | `#bf8700` |
| 3rd | green | `#1a7f37` |
| 4th | purple | `#8250df` |
| 5th | red | `#cf222e` |
| 6th | teal | `#1f88aa` |

Color must be a 3/4/6/8-digit hex string. `"red"`, `"rgb(...)"`, missing,
or malformed values silently fall back to the default blue.

### What gets rendered when

| `knobMeta`                           | Panel dot | In-page ring + badge |
|--------------------------------------|:---------:|:---:|
| absent                               |     —     |  —  |
| `{ color: "#abc" }` (no `highlight`) |     —     |  —  |
| `{ highlight: true }`                |     ✓ (blue) | ✓ (blue) |
| `{ highlight: true, color: "#abc" }` |  ✓ (#abc) | ✓ (#abc) |

Knobs without `highlight: true` are completely silent on both surfaces —
no dot in the panel, no overlay on the page.

### Caveats

- Tagged elements get `position: relative` while the overlay is active
  so the ring/badge anchor correctly. Wrap a parent instead if your
  layout depends on a different positioning context.
- The ring is a `::after` pseudo with its own `border-radius` (so it
  can be rounder than the underlying element). It sits 4px outside the
  element's box.

---

## Knob type catalog

These are the v1 types rendered by `KnobsForm`:

| Type | UI control | Hash/read shape | Notes |
|---|---|---|---|
| `text` | single-line input | string | Supports `placeholder`. |
| `textarea` | multiline textarea | string | Supports `placeholder`, `rows`. |
| `number` | number input | number | Supports `min`, `max`, `step`. |
| `slider` | range slider | number | Provide `min` and `max`. |
| `boolean` | checkbox/toggle | boolean from `"true"`/`"false"` | Defaults to `false` in the form. |
| `select` | dropdown | option value string | Use `options`; prefer `string[]` in JSON. |
| `radio` | radio group | option value string | Use `options`; prefer `string[]` in JSON. |
| `range` | two number inputs | `[min, max]` from `"min,max"` | Validates `min <= max`. |
| `date` | date input | `YYYY-MM-DD` string | Supports date `min`/`max`. |
| `object` | grouped fieldset | child knobs write individually | Read children as `parent.child`. |
| `string-array` | repeatable text inputs | array from JSON string | `itemType: "number"` coerces to numbers. |

**Color picker is not supported in v1.** Use `text`, `select`, `radio`, or `slider` for color-like controls.

---

## Scope semantics

No `scope` means prototype-wide:

```jsonc
{
  "id": "layoutDirection",
  "type": "select",
  "label": "Layout direction",
  "options": ["horizontal", "vertical"],
  "default": "horizontal"
}
```

`scope: "/Branding"` means route-scoped:

```jsonc
{
  "id": "headline",
  "type": "text",
  "label": "Branding headline",
  "scope": "/Branding",
  "default": "Close the feedback loop."
}
```

The toolbar panel shows prototype-wide knobs plus knobs for the current route. The canvas Knobs widget can show all connected target knobs and groups route-scoped knobs into sections. `useKnob(id)` auto-detects the route; `route` and `scope` are equivalent escape hatches:

```jsx
const headline = useKnob('headline', { route: '/Branding' })
```

---

## Hash key convention and reserved ids

Formula: `knob` + `PascalCase(route)` + `PascalCase(id)`.

| Declaration | Hash key |
|---|---|
| `id: "showSocial"` | `knobShowSocial` |
| `id: "layout-direction"` | `knobLayoutDirection` |
| `id: "headline", scope: "/Branding"` | `knobBrandingHeadline` |
| nested `theme.primary` | `knobThemePrimary` |

Reserved knob ids: do not use `flow`, `scene`, `hide`, `theme`, or anything starting with `_`.

---

## Worked example — StartupSignup demo

`src/prototypes/main.folder/StartupSignup/signup.prototype.json` declares prototype-wide and `/Branding` scoped knobs:

```jsonc
{
  "meta": {
    "title": "Loopline Signup",
    "knobs": [
      {
        "id": "showSocial",
        "type": "boolean",
        "label": "Show social login",
        "default": true
      },
      {
        "id": "layoutDirection",
        "type": "select",
        "label": "Layout direction",
        "options": ["horizontal", "vertical"],
        "default": "horizontal"
      },
      {
        "id": "headline",
        "type": "text",
        "label": "Branding headline",
        "scope": "/Branding",
        "default": "Close the feedback loop."
      },
      {
        "id": "accentHue",
        "type": "slider",
        "label": "Accent hue",
        "scope": "/Branding",
        "min": 0,
        "max": 360,
        "step": 1,
        "default": 239
      }
    ]
  }
}
```

```jsx
import { useKnob } from '@dfosco/hypercanvas'

export default function StartupSignup() {
  const layoutDirection = useKnob('layoutDirection') ?? 'horizontal'
  return <main className={layoutDirection === 'vertical' ? 'lg:grid-rows-2' : 'lg:grid-cols-2'} />
}
```

```jsx
import { useKnob } from '@dfosco/hypercanvas'

export default function Branding() {
  const headline = useKnob('headline', { route: '/Branding' })
  const accentHue = useKnob('accentHue', { route: '/Branding' })
  return <aside style={{ '--brand-hue': String(accentHue ?? 239) }}>{headline}</aside>
}
```

---

## The three surfaces

### 1. `useKnob` hook — read typed values

```jsx
import { useKnob } from '@dfosco/hypercanvas'

const showSocial = useKnob('showSocial') ?? true
const headline = useKnob('headline', { scope: '/Branding' })
```

`useKnob` is read-only. If a prototype must write a knob itself, use `useOverride` with a generated key:

```jsx
import { useOverride } from '@dfosco/hypercanvas'
import { buildKnobKey } from '@dfosco/hypercanvas/core'

const key = buildKnobKey('headline', { route: '/Branding' })
const [headline, setHeadline, clearHeadline] = useOverride(key)
```

### 2. Knobs toolbar panel — tweak the current prototype/route

The `knobs` toolbar tool opens a draggable floating panel. It renders `KnobsForm` for the current prototype and route. Users can open it from the command toolbar or with `cmd + shift + k`; close with `×` or `Escape`; drag position persists in `knobsPanelX`/`knobsPanelY` hash keys.

Custom surfaces can render the same form:

```jsx
import { KnobsForm } from '@dfosco/hypercanvas'

<KnobsForm knobs={knobs} route="/Branding" />
```

### 3. `knobs` canvas widget — connect controls to targets

Add a `knobs` widget on a canvas and connect it to a prototype, component-set/story, or custom widget. Multiple targets render as tabs; no supported targets render an empty state.

Target resolution:

- `prototype` widget → `.prototype.json` knobs for `props.src`.
- `component-set` or `story` widget → `[Name].component.json` knobs via `props.storyId`.
- custom widget → `widgets.<type>.knobs[]` from the widget registry.
- external `https?://` embeds are hidden because cross-origin hashes cannot be mutated safely.

---

## Iframe-write contract — no reloads

> Knob writes from the canvas widget mutate the existing iframe's `contentWindow.location.hash` directly. They never set or recompute `iframe.src`.

Changing a knob does **not** reload the iframe. The prototype stays mounted, receives a `hashchange`, and components using `useKnob`/`useOverride` re-render in place. Never "fix" canvas writes by assigning to `iframe.src`; that breaks the no-reload guarantee.

---

## Common pitfalls

- Using knobs for content/model data — use flows/objects/records instead.
- Forgetting defaults — `useKnob` returns `undefined` when no declaration/default resolves.
- Route mismatch — prefer `scope: "/Route"` with a leading slash.
- Invalid ids — author camel-case ids; nested object child ids are flattened internally.
- Expecting color controls — color picker is v2+.
- Reloading iframes — canvas knob writes must mutate `contentWindow.location.hash`, never `iframe.src`.
