/**
 * Shared helper for resolving a story's source file path by name.
 *
 * Queries the canvas stories endpoint once and caches the name→path map for
 * the lifetime of the page. Both StoryWidget and StorySetWidget use this to
 * resolve the source file for the "edit-source" toolbar action.
 */

/** @type {Promise<Map<string, string>> | null} */
let storyPathPromise = null

/**
 * Returns the repo-relative source path for a story by its name (storyId),
 * e.g. `"src/components/Button/button.story.jsx"`.
 *
 * Results are cached after the first call; subsequent calls return immediately.
 *
 * @param {string} name — storyId value (e.g. `"Button"`)
 * @returns {Promise<string | null>}
 */
export async function getStoryPathByName(name) {
  if (!storyPathPromise) {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
    storyPathPromise = fetch(`${base}/_storyboard/canvas/stories`)
      .then((r) => r.json())
      .then((d) => new Map((d.stories || []).map((s) => [s.name, s.path])))
      .catch(() => new Map())
  }
  const map = await storyPathPromise
  return map.get(name) || null
}
