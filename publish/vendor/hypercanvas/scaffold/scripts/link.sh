#!/usr/bin/env bash
# Link all @dfosco/* packages to local storyboard-core source.
# Run from storyboard root: npm run link
#
# Prerequisites: run `npm run link` in storyboard-core first
# to register the packages globally.
#
# IMPORTANT: npm install wipes symlinks. Always re-run this script
# after any npm install in this repo.
set -euo pipefail

PACKAGES=(
  "@dfosco/storyboard-core"
  "@dfosco/storyboard-react"
  "@dfosco/storyboard-react-primer"
  "@dfosco/storyboard-react-reshaped"
  "@dfosco/tiny-canvas"
)

echo "Linking local @dfosco/* packages..."
npm link "${PACKAGES[@]}"

echo ""
echo "✔ All packages linked to local source."
echo ""
echo "⚠  Remember: 'npm install' wipes symlinks. Re-run 'npm run link' after installing packages."
