/**
 * _story.jsx — wraps every story render in this project.
 *
 * Covers: StoryPage routes, ComponentSetPage grid, InlineStoryRenderer
 * (canvas widget), componentIsolate / componentSetIsolate (iframe entries).
 *
 * Pass-through default — customize like `src/_prototype.jsx` (often the two
 * share the same providers; one common pattern is to re-export this file
 * from `_prototype.jsx`).
 */
export default function StoryWrapper({ children }) {
  return children
}
