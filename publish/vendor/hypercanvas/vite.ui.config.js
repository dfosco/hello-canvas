/**
 * Vite config for building the pre-compiled UI bundle.
 *
 * Produces dist/storyboard-ui.js + dist/storyboard-ui.css.
 * Bundles Radix UI, Tailwind CSS, and all React components
 * so consumers get a self-contained JS+CSS module.
 *
 * IMPORTANT: Stateful core modules (loader, modes, commandActions, etc.) are
 * externalized as `@dfosco/storyboard/core` imports. This ensures the compiled
 * UI bundle shares the same singleton state as the consumer app — otherwise
 * init() seeds one copy of the data index while the bundle reads from another.
 *
 * Usage:
 *   npx vite build --config vite.ui.config.js
 *   npx vite build --config vite.ui.config.js --watch   (dev mode)
 */

import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const srcDir = path.resolve(__dirname, 'src/core')

/**
 * Core JS modules that hold singleton state (module-level variables).
 * These MUST be externalized so the bundle and the consumer share one instance.
 *
 * Maps path relative to src/ → external package import specifier.
 * The consumer's Vite will resolve these via package.json exports.
 */
const sharedStateModules = {
  // Barrel re-export — handlers do `import('../../index.js')` which must
  // resolve to the consumer-installed @dfosco/storyboard/core, not get inlined.
  'index.js': '@dfosco/hypercanvas/core',
  // Top-level stateful modules → main package export
  'data/loader.js': '@dfosco/hypercanvas/core',
  'data/viewfinder.js': '@dfosco/hypercanvas/core',
  'modes/modes.js': '@dfosco/hypercanvas/core',
  'stores/commandActions.js': '@dfosco/hypercanvas/core',
  'stores/configStore.js': '@dfosco/hypercanvas/core',
  'stores/uiConfig.js': '@dfosco/hypercanvas/core',
  'stores/toolRegistry.js': '@dfosco/hypercanvas/core',
  'stores/toolbarConfigStore.js': '@dfosco/hypercanvas/core',
  'stores/toolStateStore.js': '@dfosco/hypercanvas/core',
  'stores/featureFlags.js': '@dfosco/hypercanvas/core',
  'stores/plugins.js': '@dfosco/hypercanvas/core',
  'stores/canvasConfig.js': '@dfosco/hypercanvas/core',
  'stores/commandPaletteConfig.js': '@dfosco/hypercanvas/core',
  'stores/customerModeConfig.js': '@dfosco/hypercanvas/core',
  'stores/themeStore.ts': '@dfosco/hypercanvas/core',
  'session/localStorage.js': '@dfosco/hypercanvas/core',
  'knobs/discovery.js': '@dfosco/hypercanvas/core',
  'knobs/highlight.js': '@dfosco/hypercanvas/core',
  'knobs/route.js': '@dfosco/hypercanvas/core',
  // Comments subsystem → comments barrel export
  'comments/config.js': '@dfosco/hypercanvas/comments',
  'comments/auth.js': '@dfosco/hypercanvas/comments',
  'comments/commentMode.js': '@dfosco/hypercanvas/comments',
  'comments/api.js': '@dfosco/hypercanvas/comments',
  'comments/commentCache.js': '@dfosco/hypercanvas/comments',
  'comments/commentDrafts.js': '@dfosco/hypercanvas/comments',
  'comments/metadata.js': '@dfosco/hypercanvas/comments',
  'comments/graphql.js': '@dfosco/hypercanvas/comments',
}

/**
 * Rollup plugin that rewrites imports of stateful core modules to the
 * external `@dfosco/storyboard-core` package, preventing duplication.
 */
function externalizeSharedState() {
  return {
    name: 'externalize-shared-state',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null

      // Normalize the source — it may omit the .js extension
      let normalizedSource = source
      if (!path.extname(normalizedSource)) {
        normalizedSource += '.js'
      }

      const resolved = path.resolve(path.dirname(importer), normalizedSource)

      // Only process files within our src/ directory
      if (!resolved.startsWith(srcDir + path.sep) && resolved !== srcDir) return null

      const relToSrc = path.relative(srcDir, resolved)

      if (sharedStateModules[relToSrc]) {
        return { id: sharedStateModules[relToSrc], external: true }
      }

      return null
    },
  }
}

export default defineConfig({
  plugins: [
    externalizeSharedState(),
    tailwindcss(),
  ],

  esbuild: {
    jsx: 'automatic',
  },

  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/core/ui-entry.js'),
      formats: ['es'],
      fileName: () => 'storyboard-ui.js',
    },
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: false,
    cssFileName: 'storyboard-ui',
    rollupOptions: {
      external: [
        /^@dfosco\/storyboard(\/|$)/,
        /^react($|\/)/,
        /^react-dom($|\/)/,
        'node:fs',
        'node:path',
      ],
      output: {
        // Single chunk — no code splitting for the UI bundle
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'storyboard-ui.css'
          return assetInfo.name ?? '[name].[ext]'
        },
      },
    },
    // Enable minification for production builds
    minify: 'esbuild',
    sourcemap: true,
  },
})
