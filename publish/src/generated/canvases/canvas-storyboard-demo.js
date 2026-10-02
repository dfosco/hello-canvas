export default {
  "title": "Storyboard Demo",
  "grid": true,
  "gridSize": 24,
  "colorMode": "auto",
  "widgets": [
    {
      "id": "component-set-jyuqnp",
      "type": "component-set",
      "position": {
        "x": 7720,
        "y": 4880
      },
      "props": {
        "storyId": "chart-set",
        "layout": "auto",
        "width": 2280,
        "height": 1368,
        "selected": "LineChart"
      },
      "bounds": {
        "width": 2568,
        "height": 936,
        "startX": 4811,
        "startY": 8987,
        "endX": 7379,
        "endY": 9923
      },
      "connectorIds": [
        "connector-ht152g"
      ]
    },
    {
      "id": "prototype-xtgbjt",
      "type": "prototype",
      "position": {
        "x": 2267,
        "y": 18219
      },
      "props": {
        "src": "/SiloDashboard?flow=SiloDashboard%2Fdefault",
        "originalSrc": "/SiloDashboard?flow=SiloDashboard%2Fdefault",
        "label": "",
        "width": 1368,
        "height": 744
      },
      "bounds": {
        "width": 800,
        "height": 600,
        "startX": 2267,
        "startY": 18219,
        "endX": 3067,
        "endY": 18819
      }
    },
    {
      "id": "prototype-ffkuug",
      "type": "prototype",
      "position": {
        "x": 6840,
        "y": 6504
      },
      "props": {
        "src": "/SiloDashboard#view=utilization",
        "originalSrc": "/SiloDashboard?flow=SiloDashboard%2Fdefault&_sb_studio_host=1",
        "label": "",
        "width": 2320,
        "height": 1400
      },
      "bounds": {
        "width": 800,
        "height": 600,
        "startX": 4767,
        "startY": 11311,
        "endX": 5567,
        "endY": 11911
      },
      "connectorIds": [
        "connector-xhq6kk"
      ]
    },
    {
      "id": "agent-sphuok",
      "type": "agent",
      "position": {
        "x": 5496,
        "y": 6096
      },
      "props": {
        "agentId": "codex",
        "alias": "",
        "startupCommand": "codex --dangerously-bypass-approvals-and-sandbox",
        "width": 1000,
        "height": 800,
        "prettyName": "sage-wren",
        "role": "member"
      },
      "bounds": {
        "width": 1000,
        "height": 800,
        "startX": 6263,
        "startY": 5863,
        "endX": 7263,
        "endY": 6663
      },
      "connectorIds": [
        "connector-xhq6kk",
        "connector-ht152g"
      ]
    }
  ],
  "connectors": [
    {
      "id": "connector-xhq6kk",
      "type": "connector",
      "connectorType": "default",
      "start": {
        "widgetId": "agent-sphuok",
        "anchor": "right"
      },
      "end": {
        "widgetId": "prototype-ffkuug",
        "anchor": "left"
      },
      "meta": {}
    },
    {
      "id": "connector-ht152g",
      "type": "connector",
      "connectorType": "default",
      "start": {
        "widgetId": "component-set-jyuqnp",
        "anchor": "left"
      },
      "end": {
        "widgetId": "agent-sphuok",
        "anchor": "right"
      },
      "meta": {}
    }
  ],
  "sources": [],
  "snapToGrid": true,
  "author": "dfosco",
  "description": "Prototypes, components, and more",
  "siteFrames": {}
}
