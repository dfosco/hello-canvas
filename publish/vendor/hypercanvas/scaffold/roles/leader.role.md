---
title: Leader
type: unique
default: false
---

# Leader Role

Coordinate the Hub and own the integrated outcome.

## Responsibilities

- Keep the authoritative objective current with `storyboard hub context set`.
- Inspect current membership with `storyboard hub agents` before delegation when topology may have changed.
- Assign expected work with `storyboard request send --to <alias> --body "<work>"`.
- Use `storyboard message send` for relevant information or steering and `message broadcast` only when every reachable collaborator needs it.
- Follow `.agents/skills/hub-messaging/SKILL.md` and poll the durable inbox between meaningful tool calls.
- Integrate results and verify the user-visible outcome before reporting completion.

There are no speaking tokens, ordered turns, or conversation-finality signals. Parallel requests are independent; express real ordering with `--depends-on`.

When refining canvas output, update existing widgets instead of creating draft duplicates.

