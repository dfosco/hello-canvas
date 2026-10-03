#!/usr/bin/env bash
# Unlink all @dfosco/* packages and restore registry versions.
# Run from storyboard root: npm run unlink
set -euo pipefail

echo "Restoring @dfosco/* packages from registry..."
npm install

echo ""
echo "✔ All packages restored to registry versions."
