import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import generouted from '@generouted/react-router/plugin'
import { fileURLToPath } from 'node:url'
import storyboardData from '@dfosco/hypercanvas/vite'
import storyboardServer from '@dfosco/hypercanvas/vite/server'
import notebookRoutes from '@dfosco/hypercanvas/notebook/vite-routes'
import postcssGlobalData from '@csstools/postcss-global-data'
import postcssPresetEnv from 'postcss-preset-env'
import browsers from '@github/browserslist-config'
import { globSync } from 'glob'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.HYPERCANVAS_NOTEBOOK_ROOT = path.resolve(__dirname, './notebook-content')

export default defineConfig(() => {
    const base = process.env.VITE_BASE_PATH || "/hello-canvas/"

    return {
    base,
    define: {
      'globalThis.__HYPERCANVAS_NOTEBOOK_PUBLICATION__': 'true',
      'import.meta.env.VITE_NOTEBOOK_PUBLISHED': JSON.stringify('1'),
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./notebook-content/', import.meta.url)),
        },
        dedupe: ['react', 'react-dom'],
    },
    plugins: [
        tailwindcss(),
        storyboardData(),
        storyboardServer(),
        notebookRoutes(),
        react(),
        generouted({
            source: {
                routes: './src/prototypes/**/[\\w[-]*.{jsx,tsx,mdx}',
                modals: './src/prototypes/**/[+]*.{jsx,tsx,mdx}',
            },
        }),
        // generouted's built-in watcher only listens for /src/pages/ changes.
        // This plugin triggers a full reload when prototypes are added/removed.
        {
            name: 'prototypes-watcher',
            configureServer(server) {
                const listener = (file = '') => {
                    if (file.includes(path.normalize('/src/prototypes/'))) {
                        server.ws.send({ type: 'full-reload' })
                    }
                }
                server.watcher.on('add', listener)
                server.watcher.on('unlink', listener)
            },
        },
        {
            name: 'base-redirect',
            configureServer(server) {
                const baseNoTrail = base.replace(/\/$/, '')
                server.middlewares.use((req, res, next) => {
                    if (req.url === baseNoTrail) {
                        res.writeHead(302, { Location: base })
                        res.end()
                        return
                    }
                    if (req.url && req.url !== baseNoTrail && !req.url.startsWith(base) && !req.url.startsWith('/@') && !req.url.startsWith('/node_modules/')) {
                        const newUrl = baseNoTrail + req.url
                        res.writeHead(302, { Location: newUrl })
                        res.end()
                        return
                    }
                    next()
                })
            },
        },
    ],
    server: {
        port: 1234,
        fs: { allow: ['..'] },
        warmup: {
            clientFiles: [
                'src/library/mount.jsx',
                'src/library/prototypes-entry.jsx',
                'src/prototypes/**/*.jsx',
                'src/components/**/*.jsx',
                'src/templates/**/*.jsx',
            ],
        },
    },
    optimizeDeps: {
        include: [
            '@primer/react',
            '@primer/octicons-react',
            'prop-types',
            '@base-ui/react/accordion',
            '@base-ui/react/checkbox',
            '@base-ui/react/dialog',
            '@base-ui/react/number-field',
            '@base-ui/react/progress',
            '@base-ui/react/radio',
            '@base-ui/react/radio-group',
            '@base-ui/react/select',
            '@base-ui/react/slider',
            '@base-ui/react/switch',
            '@base-ui/react/tabs',
            '@base-ui/react/tooltip',
            // CommonJS leaf pulled in transitively via @dfosco/storyboard ->
            // unified (markdown). unified does `import extend from 'extend'`,
            // but `extend` is CJS; without pre-bundling Vite serves it raw and
            // the default-import interop fails ("does not provide an export
            // named 'default'"). Forcing it into optimizeDeps gives it a
            // synthesized default export.
            'extend',
        ],
    },
    esbuild: {
        // Preserve function names so the storyboard inspector shows
        // real component names instead of minified identifiers
        keepNames: true,
    },
    build: {
        chunkSizeWarningLimit: 700,
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-primer': ['@primer/react'],
                    'vendor-octicons': ['@primer/octicons-react'],
                },
            },
        },
    },
    css: {
        postcss: {
            plugins: [
                postcssGlobalData({
                    files: globSync(
                        'node_modules/@primer/primitives/dist/css/**/*.css',
                        { ignore: ['**/themes/**'] }
                    ),
                }),
                postcssPresetEnv({
                    stage: 2,
                    browsers,
                    features: {
                        'nesting-rules': {
                            noIsPseudoSelector: true,
                        },
                        'focus-visible-pseudo-class': false,
                        'logical-properties-and-values': false,
                    },
                }),
            ],
        },
    },
}})
