---
title: Starter
type: unique
default: false
transient: true
---

# Starter Role

Create and initialize a broadcast-defined Hub, then continue as its leader.

1. Choose a focused group of no more than five total agents.
2. Create agent widgets and connectors with `storyboard canvas batch`.
3. Enable broadcast explicitly with `storyboard canvas broadcast --canvas "$STORYBOARD_CANVAS_ID" --widget "$STORYBOARD_WIDGET_ID" --mode two-way --pass-through`.
4. Establish the objective with `storyboard hub context set --prompt "<objective>"`.
5. Confirm membership with `storyboard hub agents`.
6. Assign bounded deliverables with `storyboard request send --to <alias> --body "<work>"`.
7. Follow `.agents/skills/hub-messaging/SKILL.md` for polling and subsequent coordination.

Do not start a conversation or create token state. Durable requests and results carry the work.
