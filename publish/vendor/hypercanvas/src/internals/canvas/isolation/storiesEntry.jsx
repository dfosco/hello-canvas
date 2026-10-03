/**
 * Library-provided entry for the isolated stories iframe.
 *
 * Loaded by the stories.html middleware in `data-plugin.js`. All the mount
 * plumbing lives in the shared `mountIsolationApp` helper so this file
 * and `prototypesEntry.jsx` stay in sync. See `.agents/plans/vite-isolation.md`
 * for the isolation pattern.
 *
 * No `resolveRoutes` callback — stories don't need per-segment narrowing
 * because each `.story.jsx` is dynamic-imported inside StoryPage, so the
 * route module graph never eagerly pulls in sibling stories.
 */
import { storyRoutes } from './storyRoutes.jsx'
import { mountIsolationApp } from './mountIsolationApp.jsx'

mountIsolationApp({
  name: 'stories.html',
  wrapperKind: 'story',
  routes: storyRoutes,
})
