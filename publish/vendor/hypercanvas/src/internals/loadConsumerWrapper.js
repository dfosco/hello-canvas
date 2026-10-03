/**
 * loadConsumerWrapper — resolves the consumer's `src/_prototype.jsx` or
 * `src/_story.jsx` at runtime so storyboard internals (prototype routes,
 * story page, inline story renderer, isolate iframes) can wrap rendered
 * content with the consumer's design-system providers.
 *
 * These two files are documented as **the** seam between storyboard
 * scaffolding and consumer source code. See plan
 * `.github/plans/style-separation.md`.
 *
 * Falls back to a Fragment pass-through when the wrapper file is absent —
 * which corresponds to "blank slate", the new default.
 *
 * Why a glob: `import.meta.glob` resolves paths against the *consumer*
 * Vite project root, so the same code path works in source-repo dev and in
 * published-package consumers.
 *
 * Why lazy (no eager): we want to defer wrapper-file evaluation until
 * something actually needs to render. Eager evaluation would pull every
 * wrapper module into the test environment (the wrappers typically import
 * design-system code that doesn't mock cleanly), and would inflate the
 * initial bundle even when no story/prototype is visible.
 */
import { Fragment, lazy, createElement } from 'react'

const PROTOTYPE_MODULES = import.meta.glob(
  ['/src/_prototype.jsx', '/src/_prototype.tsx'],
)
const STORY_MODULES = import.meta.glob(
  ['/src/_story.jsx', '/src/_story.tsx'],
)

function PassThrough({ children }) {
  return createElement(Fragment, null, children)
}

function makeLazyWrapper(modules) {
  const keys = Object.keys(modules)
  if (keys.length === 0) return PassThrough
  return lazy(async () => {
    const mod = await modules[keys[0]]()
    if (typeof mod?.default === 'function') return { default: mod.default }
    return { default: PassThrough }
  })
}

let _protoCache
let _storyCache

/** Wrapper for prototype routes (workspace SPA + iframe entries). */
export function getPrototypeWrapper() {
  if (!_protoCache) _protoCache = makeLazyWrapper(PROTOTYPE_MODULES)
  return _protoCache
}

/** Wrapper for story renders (StoryPage, ComponentSetPage, isolates, inline renderer). */
export function getStoryWrapper() {
  if (!_storyCache) _storyCache = makeLazyWrapper(STORY_MODULES)
  return _storyCache
}
