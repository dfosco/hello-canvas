---
name: hub-messaging
description: Coordinate with agents in a Hypercanvas messaging hub by polling a durable inbox, sending messages or requests, and recording completed results. Use when an agent has Hub context or needs to communicate with connected collaborators.
---

# Hub Messaging

Use the durable inbox as the source of truth. Runtime delivery adapters may surface messages sooner, but polling is the portable baseline and recovery path.

## Establish context

At the start of Hub work, run:

```bash
storyboard hub context
storyboard hub agents
```

The CLI derives the current widget and canvas from `STORYBOARD_WIDGET_ID` and `STORYBOARD_CANVAS_ID`. Address peers by their stable Hub name. Supply explicit identity flags only when operating outside an agent session.

## Polling contract

Run `storyboard inbox poll`:

- before starting a new unit of work;
- after a meaningful tool result;
- before a consequential decision or edit; and
- immediately before the final response.

`inbox poll` prints one consolidated update and then marks exactly those events consumed. No output means there is no new work. Consumed means incorporated into model context; it does not mean the requested work is complete.

A runtime adapter may inject a `Hypercanvas Hub update`. Treat it exactly like polled inbox content. Continue polling because adapter delivery is optional and failures leave events available.

## Send information and work

Use direct messages when one collaborator is affected and broadcast only when every current Hub member needs the information:

```bash
storyboard message send --to researcher --body "The API contract changed." --intent inform
storyboard message broadcast --body "The shared schema is ready." --intent steer
```

Use a request when a response or deliverable is expected:

```bash
storyboard request send --to reviewer --body "Review the schema migration."
storyboard request complete --request <request-id> --body "Review complete; no blockers."
```

Keep messages decision-relevant. Do not send routine progress chatter. Re-read `storyboard hub agents` when membership may have changed, and do not assume departed agents remain recipients.

Before completing a request, verify its dependencies are complete. The durable request and result records replace turn tokens, delegation state, and conversation-finality signals.

## Leader completion gate

Sending work is not completion. A Hub leader must keep every returned request ID and may not give a final answer while any required request lacks a matching completion result or its assigned peer is still working.

Before the final response, the leader must:

1. Run `storyboard inbox poll` and incorporate every returned result or design recommendation.
2. Run `storyboard hub agents`, then check each required peer with `storyboard agent status --widget <widget-id>`. If a peer is still working, continue useful local work and poll again; do not silently replace the peer's assignment and finalize around it.
3. Confirm that every requested deliverable has either completed or been explicitly cancelled with a reason stated to the user.
4. For work whose outcome should be visible on the canvas, verify the result widget exists. A new prototype route must be added as a `prototype` widget; a route name in prose is not a canvas deliverable.

If feedback arrives after implementation, review it and apply or explicitly reject it before finalizing. Never claim that Hub coordination succeeded when the CLI commands failed or no peer result was received.
