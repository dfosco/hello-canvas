#!/usr/bin/env bash
#
# generate-catalog.sh — Generate a component catalog skill for any design system
#
# Usage:
#   .agents/skills/design-system-catalog/generate-catalog.sh <package-name> [display-name]
#
# Examples:
#   .agents/skills/design-system-catalog/generate-catalog.sh @primer/react "Primer React"
#   .agents/skills/design-system-catalog/generate-catalog.sh @chakra-ui/react "Chakra UI"
#   .agents/skills/design-system-catalog/generate-catalog.sh antd "Ant Design"

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# Resolve skills base directory — priority: .agents → .github → .claude
SKILLS_BASE=""
for candidate in .agents/skills .github/skills .claude/skills; do
  if [ -d "$REPO_ROOT/$candidate/design-system-catalog" ]; then
    SKILLS_BASE="$candidate"
    break
  fi
done

if [ -z "$SKILLS_BASE" ]; then
  echo "Error: design-system-catalog skill not found in .agents/skills, .github/skills, or .claude/skills" >&2
  exit 1
fi

SKILL_DIR="$REPO_ROOT/$SKILLS_BASE/design-system-catalog"
EXTRACTOR="$SKILL_DIR/extract-components.mjs"

PACKAGE_NAME="${1:?Usage: generate-catalog.sh <package-name> [display-name]}"
DISPLAY_NAME="${2:-}"

# ── Derive names ─────────────────────────────────────────────

# Skill name: strip @, replace / with -, lowercase
SKILL_NAME="${PACKAGE_NAME#@}"
SKILL_NAME="${SKILL_NAME////-}"
SKILL_NAME=$(echo "$SKILL_NAME" | tr '[:upper:]' '[:lower:]')
CATALOG_SKILL_NAME="${SKILL_NAME}-components-catalog"

# Display name: auto-derive if not provided
if [ -z "$DISPLAY_NAME" ]; then
  # @primer/react → Primer React, antd → Antd, @chakra-ui/react → Chakra Ui React
  DISPLAY_NAME=$(echo "$SKILL_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')
fi

OUTPUT_DIR="$REPO_ROOT/$SKILLS_BASE/$CATALOG_SKILL_NAME"
OUTPUT_FILE="$OUTPUT_DIR/SKILL.md"

echo "Package:      $PACKAGE_NAME"
echo "Display name: $DISPLAY_NAME"
echo "Skill name:   $CATALOG_SKILL_NAME"
echo "Output dir:   $OUTPUT_DIR"
echo ""

# ── Validate ─────────────────────────────────────────────────

if [ ! -f "$EXTRACTOR" ]; then
  echo "Error: extractor not found at $EXTRACTOR" >&2
  exit 1
fi

PKG_DIR="$REPO_ROOT/node_modules/${PACKAGE_NAME}"
if [ ! -d "$PKG_DIR" ]; then
  echo "Error: $PACKAGE_NAME not installed. Run npm install first." >&2
  exit 1
fi

VERSION=$(node -e "console.log(require('$PKG_DIR/package.json').version)" 2>/dev/null || echo "unknown")

# ── Extract components ───────────────────────────────────────

TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

echo "Extracting components from $PACKAGE_NAME@$VERSION ..."
REPO_ROOT="$REPO_ROOT" node "$EXTRACTOR" "$PACKAGE_NAME" > "$TMP_DIR/components.json" 2>"$TMP_DIR/extract.log"

cat "$TMP_DIR/extract.log" >&2

TOTAL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/components.json','utf-8')).totalComponents)")

if [ "$TOTAL" -eq 0 ]; then
  echo "Error: no components found in $PACKAGE_NAME. Check that the package has TypeScript declarations." >&2
  exit 1
fi

echo "Found $TOTAL components."

# ── Format catalog markdown ──────────────────────────────────

COMPONENTS_JSON="$TMP_DIR/components.json" node --input-type=module << 'FORMATTER' > "$TMP_DIR/catalog.md"
import { readFileSync } from 'fs';

const data = JSON.parse(readFileSync(process.env.COMPONENTS_JSON, 'utf-8'));
const { packageName, version, components } = data;

// Group components by category
const groups = {};
for (const comp of components) {
  const cat = comp.category || 'Components';
  if (!groups[cat]) groups[cat] = [];
  groups[cat].push(comp);
}

// Sort categories: known categories first, then alphabetical
const knownOrder = [
  'Layout', 'Navigation', 'Actions', 'Actions & Menus', 'Forms',
  'Data Display', 'Feedback', 'Overlays', 'Content', 'Typography',
  'Utilities', 'General', 'Components',
];
const allCategories = Object.keys(groups);
const sorted = [
  ...knownOrder.filter(c => allCategories.includes(c)),
  ...allCategories.filter(c => !knownOrder.includes(c)).sort(),
];

let md = '';
md += `## Component Index\n\n`;

let totalCount = 0;

for (const cat of sorted) {
  const comps = groups[cat];
  if (!comps || comps.length === 0) continue;

  comps.sort((a, b) => a.name.localeCompare(b.name));

  md += `### ${cat}\n\n`;

  for (const comp of comps) {
    totalCount++;
    md += `#### \`${comp.name}\`\n\n`;
    md += `\`\`\`jsx\nimport { ${comp.name} } from '${comp.importPath}'\n\`\`\`\n\n`;

    if (comp.subComponents.length > 0) {
      md += '**Sub-components:** ';
      md += comp.subComponents.map(s => `\`${comp.name}.${s}\``).join(', ');
      md += '\n\n';
    }

    if (comp.props.length > 0) {
      md += '**Props:**\n\n';
      md += '| Prop | Type |\n';
      md += '|------|------|\n';
      for (const prop of comp.props) {
        const safeType = prop.type.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        md += `| \`${prop.name}\` | \`${safeType}\` |\n`;
      }
      md += '\n';
    }
  }
}

md += '---\n\n';
md += `_${totalCount} components total from ${packageName}@${version}._\n`;

process.stdout.write(md);
FORMATTER

# ── Create output skill directory ────────────────────────────

mkdir -p "$OUTPUT_DIR"

# ── Write SKILL.md ───────────────────────────────────────────

cat > "$OUTPUT_FILE" << SKILLEOF
# ${DISPLAY_NAME} Components Catalog

> Triggered by: ANY code that imports from \`${PACKAGE_NAME}\`, "what ${DISPLAY_NAME} components are available", "${DISPLAY_NAME,,} component list", "${DISPLAY_NAME,,} components", when building UI with ${DISPLAY_NAME}

> Auto-update trigger: When \`package.json\` is modified and \`${PACKAGE_NAME}\` version changes, regenerate this catalog.

## What This Does

Provides a complete catalog of all \`${PACKAGE_NAME}\` components available in this codebase. Each entry includes the component name, import path, sub-components (for compound components), and props with types.

## When This Applies

- Building any new page or component that uses ${DISPLAY_NAME}
- Deciding which component to use for a UI pattern
- Looking up props or sub-components for a specific component

## How to Use

1. **Find the right component** — Browse by category or search alphabetically
2. **Check sub-components** — Compound components list their sub-components (e.g. \`Table.Cell\`)
3. **Check props** — Each component lists its specific props with types
4. **Import** — Use the import path shown (always \`${PACKAGE_NAME}\`)

### Regenerating This Catalog

When \`${PACKAGE_NAME}\` is upgraded, regenerate with:

\`\`\`bash
${SKILLS_BASE}/${CATALOG_SKILL_NAME}/extract-components.sh
\`\`\`

<!-- CATALOG -->
<!-- Generated from ${PACKAGE_NAME}@${VERSION} — do not edit manually -->
<!-- Run ${SKILLS_BASE}/${CATALOG_SKILL_NAME}/extract-components.sh to regenerate -->

---

SKILLEOF

# Append the formatted catalog
cat "$TMP_DIR/catalog.md" >> "$OUTPUT_FILE"

# ── Write regeneration script ────────────────────────────────

REGEN_SCRIPT="$OUTPUT_DIR/extract-components.sh"
cat > "$REGEN_SCRIPT" << 'REGENEOF'
#!/usr/bin/env bash
#
# Regenerate the component catalog for PACKAGE_PLACEHOLDER
#
# This is a thin wrapper around the shared design-system-catalog extractor.
# Run this script when the package is upgraded to refresh the catalog.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

GENERATOR=""
for candidate in .agents/skills .github/skills .claude/skills; do
  if [ -f "$REPO_ROOT/$candidate/design-system-catalog/generate-catalog.sh" ]; then
    GENERATOR="$REPO_ROOT/$candidate/design-system-catalog/generate-catalog.sh"
    break
  fi
done

if [ -z "$GENERATOR" ]; then
  echo "Error: design-system-catalog skill not found in .agents/skills, .github/skills, or .claude/skills" >&2
  echo "The shared extractor is required to regenerate this catalog." >&2
  exit 1
fi

exec "$GENERATOR" "PACKAGE_PLACEHOLDER" "DISPLAY_PLACEHOLDER"
REGENEOF

# Replace placeholders
sed -i '' "s|PACKAGE_PLACEHOLDER|${PACKAGE_NAME}|g" "$REGEN_SCRIPT"
sed -i '' "s|DISPLAY_PLACEHOLDER|${DISPLAY_NAME}|g" "$REGEN_SCRIPT"
chmod +x "$REGEN_SCRIPT"

echo ""
echo "✅ Generated skill: $CATALOG_SKILL_NAME"
echo "   Skill file: $OUTPUT_FILE"
echo "   Regenerate: $REGEN_SCRIPT"
echo "   Components: $TOTAL from ${PACKAGE_NAME}@${VERSION}"
