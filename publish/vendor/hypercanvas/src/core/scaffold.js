#!/usr/bin/env node
/**
 * storyboard-scaffold — thin shim that re-exports the implementation from
 * ./scaffold/index.js. Keeps `bin.storyboard-scaffold` resolving to a stable
 * path while the actual logic lives in a dedicated directory.
 */
import './scaffold/index.js'
