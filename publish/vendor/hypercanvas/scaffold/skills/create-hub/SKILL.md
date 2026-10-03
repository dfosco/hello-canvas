---
name: create-hub
description: 'Creates a multi-agent Hub on the canvas, enables broadcast-defined membership, establishes shared context, and sends initial work requests. Use when asked to "create a hub", "spawn a hub", "set up a hub", or "Hub: [task]".'
---

# Create Hub

> Triggered by: "create a hub", "spawn a hub", "set up a hub", "Hub:", "create a hub for", "spawn a hub with", "set up a hub to"

## What This Does

Creates a multi-agent hub on the current canvas. Each agent you create is a **real, autonomous AI session** — an independent process running its own Copilot/Claude/Codex/OpenCode CLI instance in its own tmux session. They are NOT simulations or stubs. They boot up, receive role instructions, read the codebase, run tools, and produce real work.

## Prerequisites

- `STORYBOARD_CANVAS_ID` and `STORYBOARD_WIDGET_ID` identify the current canvas and leader.
- The Hypercanvas dev server is running.

## Procedure

### Step 1: Determine the hub composition

Based on the user's request, decide:
- How many agents are needed (minimum 2 total, including yourself)
- What each agent's name/specialization should be
- What agent type each should be (keys from the terminal agent config — typically `"copilot"`, `"claude"`, `"codex"`, `"opencode"`)

Default agent type is `"copilot"`. Keep hubs small (2–5 agents is typical).

### Step 2: Create agent widgets and connectors

Use `storyboard canvas batch` to create all agent widgets and connectors in a single call. Use `$0`, `$1`, etc. to reference widget IDs from earlier create ops. The `alias` prop gives agents a human-readable nickname; their auto-generated `prettyName` (e.g. `ivory-avocet`) serves as a unique fallback.

**Layout:** Agents fan out from the leader in a `<` pattern — the leader is on the left, peers spread to the upper-right and lower-right. Use diagonal directions (`above-right`, `below-right`) and `gap: 8` (grid spaces) — diagonals center on the leader vertically, so two peers end up 8gS apart. The horizontal offset is also 8gS, which gives connectors room to render cleanly.

For **2 peers** (most common):
```bash
storyboard canvas batch --canvas "$STORYBOARD_CANVAS_ID" --ops '[
  { "op": "create-widget", "type": "agent", "near": "'"$STORYBOARD_WIDGET_ID"'", "direction": "above-right", "gap": 8, "props": { "alias": "Research Agent", "agentId": "copilot" } },
  { "op": "create-widget", "type": "agent", "near": "'"$STORYBOARD_WIDGET_ID"'", "direction": "below-right", "gap": 8, "props": { "alias": "Review Agent", "agentId": "copilot" } },
  { "op": "create-connector", "startWidgetId": "'"$STORYBOARD_WIDGET_ID"'", "startAnchor": "right", "endWidgetId": "$0", "endAnchor": "left" },
  { "op": "create-connector", "startWidgetId": "'"$STORYBOARD_WIDGET_ID"'", "startAnchor": "right", "endWidgetId": "$1", "endAnchor": "left" }
]'
```

For **3 peers**, add a `right` (center) agent:
```bash
storyboard canvas batch --canvas "$STORYBOARD_CANVAS_ID" --ops '[
  { "op": "create-widget", "type": "agent", "near": "'"$STORYBOARD_WIDGET_ID"'", "direction": "above-right", "gap": 8, "props": { "alias": "Agent A", "agentId": "copilot" } },
  { "op": "create-widget", "type": "agent", "near": "'"$STORYBOARD_WIDGET_ID"'", "direction": "right", "gap": 8, "props": { "alias": "Agent B", "agentId": "copilot" } },
  { "op": "create-widget", "type": "agent", "near": "'"$STORYBOARD_WIDGET_ID"'", "direction": "below-right", "gap": 8, "props": { "alias": "Agent C", "agentId": "copilot" } },
  { "op": "create-connector", "startWidgetId": "'"$STORYBOARD_WIDGET_ID"'", "startAnchor": "right", "endWidgetId": "$0", "endAnchor": "left" },
  { "op": "create-connector", "startWidgetId": "'"$STORYBOARD_WIDGET_ID"'", "startAnchor": "right", "endWidgetId": "$1", "endAnchor": "left" },
  { "op": "create-connector", "startWidgetId": "'"$STORYBOARD_WIDGET_ID"'", "startAnchor": "right", "endWidgetId": "$2", "endAnchor": "left" }
]'
```

For **4 peers**, use all four: `above-right`, `right` (×2 stacked), `below-right`. For a single peer, use `right` with `gap: 8`.

**Connector anchors:** Since the fan always places peers to the right of the leader, use `startAnchor: "right"` on the leader and `endAnchor: "left"` on each peer. This matches the 9-cell orientation table (leader is `center-left` relative to all peers).

The output contains an array of results. Each `create-widget` result has a `widgetId` field.

For a single agent, you can use `storyboard canvas add` instead:

```bash
storyboard canvas add agent --canvas "$STORYBOARD_CANVAS_ID" --json \
  --name "Research Agent" --near "$STORYBOARD_WIDGET_ID" --gap 8 --props '{"agentId": "copilot"}'
```

### Step 3: Ensure broadcast is active

Broadcast is automatically enabled for agent↔agent connectors when a hub forms. However, the leader **must** verify and explicitly enable it as a safety net. Always run this after creating connectors:
1. Choose 1–4 additional agents and give each a short, unique `alias` describing its specialization. Use agent IDs configured in `canvas.agents`.
2. Create the agent widgets and connectors in one `storyboard canvas batch` call. Fan peers to the right of the leader and use matching connector anchors.
3. Explicitly enable two-way broadcast across the component:

```bash
storyboard canvas broadcast \
  --canvas "$STORYBOARD_CANVAS_ID" \
  --widget "$STORYBOARD_WIDGET_ID" \
  --mode two-way \
  --pass-through
```

4. Establish the shared prompt as soon as the Hub materializes:

```bash
storyboard hub context set --prompt "<user objective>" --summary "<concise objective>"
storyboard hub context
storyboard hub agents
```

5. Agent widgets start when rendered by the browser. Once collaborators appear in `hub agents`, send each expected deliverable as a durable request:

```bash
storyboard request send --to <agent-alias> --body "<bounded assignment>"
```

6. Follow `.agents/skills/hub-messaging/SKILL.md`: poll the inbox between meaningful tool calls, incorporate results, and send direct or broadcast messages only when useful.
7. Do not finalize merely because peers were spawned or requests were sent. Apply the Hub messaging leader completion gate: wait for required results, incorporate feedback, and verify the requested canvas artifact is visible.

## Batch example

```bash
storyboard canvas batch --canvas "$STORYBOARD_CANVAS_ID" --ops '[
  { "op": "create-widget", "type": "agent", "near": "'"$STORYBOARD_WIDGET_ID"'", "direction": "above-right", "gap": 8, "props": { "alias": "research", "agentId": "codex", "initialPrompt": "Investigate the API semantics." } },
  { "op": "create-widget", "type": "agent", "near": "'"$STORYBOARD_WIDGET_ID"'", "direction": "below-right", "gap": 8, "props": { "alias": "review", "agentId": "codex", "initialPrompt": "Review the implementation for correctness." } },
  { "op": "create-connector", "startWidgetId": "'"$STORYBOARD_WIDGET_ID"'", "startAnchor": "right", "endWidgetId": "$0", "endAnchor": "left" },
  { "op": "create-connector", "startWidgetId": "'"$STORYBOARD_WIDGET_ID"'", "startAnchor": "right", "endWidgetId": "$1", "endAnchor": "left" }
]'
```

## Guardrails

- Create a Hub only when explicitly requested.
- Keep the Hub to five agents or fewer unless the user specifies otherwise.
- Use unique aliases; agents address one another by these stable names.
- Do not create conversation state, turn tokens, claims, leases, or synthetic finality.
- Update existing output widgets during refinement instead of leaving draft trails.
- Use `right→left`, `bottom→top`, `top→bottom`, or `left→right` anchors matching actual placement.
