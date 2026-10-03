/**
 * _prototype.jsx — wraps every prototype route in this project.
 *
 * Storyboard resolves this file via `import.meta.glob('/src/_prototype.{jsx,tsx}')`
 * and wraps every prototype route's render with the default export — both in
 * the workspace SPA (src/library/mount.jsx) and in the isolated
 * `prototypes.html` iframe (src/library/prototypes-entry.jsx) used by
 * canvas PrototypeEmbed widgets.
 *
 * By default, this is a pass-through (no providers, no CSS). Customize freely:
 * - Add an `import './_prototype.css'` and import your design tokens / Tailwind / fonts
 * - Wrap in your design system's ThemeProvider (Primer, Reshaped, Chakra, etc.)
 *
 * IMPORTANT: import design-system CSS HERE rather than only in mount.jsx.
 * mount.jsx is the SPA entry — anything imported there is missing from the
 * isolated prototypes.html bundle, so the same prototype renders correctly
 * via direct load but appears broken when embedded in a canvas. Importing
 * from this wrapper guarantees both entries pick it up.
 *
 * Delete this file entirely if you want prototypes to render with absolutely
 * nothing inherited from storyboard.
 */
export default function PrototypeWrapper({ children }) {
  return children
}
