export default {
  "title": "Base UI Showcase",
  "description": "Live tour of base-ui/react components",
  "grid": true,
  "gridSize": 24,
  "colorMode": "auto",
  "sources": [
    {
      "export": "PrimaryButtons",
      "position": {
        "x": 2026,
        "y": 1002
      },
      "width": 560,
      "height": 400
    },
    {
      "export": "DangerButtons",
      "position": {
        "x": 125,
        "y": 1121
      },
      "width": 487,
      "height": 102
    }
  ],
  "widgets": [
    {
      "id": "markdown-crjcuk",
      "type": "markdown",
      "position": {
        "x": 8160,
        "y": 2664
      },
      "props": {
        "content": "# Base UI Showcase\n\nA curated tour of [Base UI](https://base-ui.com) — the headless, accessible React component library from the team behind MUI, Radix and Floating UI.\n\nEach block pairs a short overview with a live `component-set` widget rendering every variant of that primitive, styled with Tailwind to fit the current theme.",
        "width": 1608,
        "height": 120
      },
      "bounds": {
        "width": 1608,
        "height": 120,
        "startX": 24,
        "startY": 24,
        "endX": 1632,
        "endY": 144
      }
    },
    {
      "id": "markdown-u9asxj",
      "type": "markdown",
      "position": {
        "x": 8160,
        "y": 2832
      },
      "props": {
        "content": "## Checkbox\n\nBinary input with full keyboard and ARIA support. Supports `checked`, `defaultChecked`, `indeterminate`, and `disabled` states. Use inside a `<Field>` for built-in label and error wiring.",
        "width": 780,
        "height": 120
      },
      "bounds": {
        "width": 780,
        "height": 120,
        "startX": 24,
        "startY": 216,
        "endX": 804,
        "endY": 336
      }
    },
    {
      "id": "component-set-hrmb85",
      "type": "component-set",
      "position": {
        "x": 8161,
        "y": 2999
      },
      "props": {
        "storyId": "base-ui-checkbox",
        "layout": "horizontal",
        "width": 1881.7840837868987,
        "height": 357
      },
      "bounds": {
        "width": 780,
        "height": 420,
        "startX": 24,
        "startY": 360,
        "endX": 804,
        "endY": 780
      }
    },
    {
      "id": "markdown-utjzv7",
      "type": "markdown",
      "position": {
        "x": 8160,
        "y": 3408
      },
      "props": {
        "content": "## Switch\n\nToggle for on/off preferences — use when the change applies immediately (no save button). The thumb is a separate part so you can fully customize its motion and easing.",
        "width": 1032,
        "height": 120
      },
      "bounds": {
        "width": 780,
        "height": 120,
        "startX": 852,
        "startY": 216,
        "endX": 1632,
        "endY": 336
      }
    },
    {
      "id": "component-set-uthky5",
      "type": "component-set",
      "position": {
        "x": 8160,
        "y": 3576
      },
      "props": {
        "storyId": "base-ui-switch",
        "layout": "horizontal",
        "width": 1025.8332371508332,
        "height": 357
      },
      "bounds": {
        "width": 780,
        "height": 420,
        "startX": 852,
        "startY": 360,
        "endX": 1632,
        "endY": 780
      }
    },
    {
      "id": "markdown-e0yznc",
      "type": "markdown",
      "position": {
        "x": 9216,
        "y": 4248
      },
      "props": {
        "content": "## Radio Group\n\nGroup of mutually exclusive options. The `RadioGroup` owns the value; each `Radio.Root` is anatomically a button so it can render anything you want as the visual indicator.",
        "width": 780,
        "height": 120
      },
      "bounds": {
        "width": 780,
        "height": 120,
        "startX": 24,
        "startY": 852,
        "endX": 804,
        "endY": 972
      }
    },
    {
      "id": "component-set-w7dnzj",
      "type": "component-set",
      "position": {
        "x": 9216,
        "y": 4416
      },
      "props": {
        "storyId": "base-ui-radio-group",
        "layout": "horizontal",
        "width": 1056,
        "height": 360
      },
      "bounds": {
        "width": 780,
        "height": 420,
        "startX": 24,
        "startY": 996,
        "endX": 804,
        "endY": 1416
      }
    },
    {
      "id": "markdown-sjyf27",
      "type": "markdown",
      "position": {
        "x": 8160,
        "y": 3960
      },
      "props": {
        "content": "## Select\n\nListbox-style dropdown with optional groups, keyboard navigation, typeahead, and Floating UI positioning. Portal-rendered so it floats above any container overflow.",
        "width": 1008,
        "height": 120
      },
      "bounds": {
        "width": 780,
        "height": 120,
        "startX": 852,
        "startY": 1488,
        "endX": 1632,
        "endY": 1608
      }
    },
    {
      "id": "component-set-qhap4o",
      "type": "component-set",
      "position": {
        "x": 8160,
        "y": 4104
      },
      "props": {
        "storyId": "base-ui-select",
        "layout": "horizontal",
        "width": 1008,
        "height": 360
      },
      "bounds": {
        "width": 780,
        "height": 420,
        "startX": 852,
        "startY": 1632,
        "endX": 1632,
        "endY": 2052
      }
    },
    {
      "id": "markdown-e4u4qw",
      "type": "markdown",
      "position": {
        "x": 8160,
        "y": 4488
      },
      "props": {
        "content": "## Tabs\n\nHorizontal or vertical tab list. `Tabs.Indicator` animates between selected tabs using the CSS variables it exposes (`--active-tab-left`, `--active-tab-width`, etc.).",
        "width": 1008,
        "height": 120
      },
      "bounds": {
        "width": 780,
        "height": 120,
        "startX": 24,
        "startY": 2124,
        "endX": 804,
        "endY": 2244
      }
    },
    {
      "id": "component-set-9gft3x",
      "type": "component-set",
      "position": {
        "x": 8160,
        "y": 4632
      },
      "props": {
        "storyId": "base-ui-tabs",
        "layout": "horizontal",
        "width": 1008,
        "height": 336
      },
      "bounds": {
        "width": 780,
        "height": 420,
        "startX": 24,
        "startY": 2268,
        "endX": 804,
        "endY": 2688
      }
    },
    {
      "id": "component-set-7fwior",
      "type": "component-set",
      "position": {
        "x": 9213,
        "y": 3565
      },
      "props": {
        "storyId": "base-ui-accordion",
        "layout": "auto",
        "selected": "",
        "width": 1400,
        "height": 440
      },
      "bounds": {
        "width": 270,
        "height": 170,
        "startX": 9615,
        "startY": 4066,
        "endX": 9885,
        "endY": 4236
      }
    },
    {
      "id": "markdown-7jxuds",
      "type": "markdown",
      "position": {
        "x": 9216,
        "y": 3408
      },
      "props": {
        "content": "## Accordion\n\nDisclosure list where multiple panels can be open at once. Supports controlled or uncontrolled `value` (array of open item values) and ships with smooth open/close animations.",
        "width": 780,
        "height": 120
      },
      "bounds": {
        "width": 780,
        "height": 120,
        "startX": 852,
        "startY": 2124,
        "endX": 1632,
        "endY": 2244
      }
    },
    {
      "id": "agent-sgj29p",
      "type": "agent",
      "position": {
        "x": 6960,
        "y": 4248
      },
      "props": {
        "agentId": "codex",
        "alias": "",
        "startupCommand": "codex --dangerously-bypass-approvals-and-sandbox",
        "width": 1000,
        "height": 800,
        "prettyName": "sage-falcon",
        "role": "member"
      },
      "bounds": {
        "width": 1000,
        "height": 800,
        "startX": 7581,
        "startY": 4169,
        "endX": 8581,
        "endY": 4969
      }
    }
  ],
  "author": "dfosco",
  "connectors": [],
  "snapToGrid": true,
  "siteFrames": {}
}
