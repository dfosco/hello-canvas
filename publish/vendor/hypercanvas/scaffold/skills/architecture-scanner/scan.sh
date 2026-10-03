#!/usr/bin/env bash
#
# scan.sh — Architecture scanner
#
# Scans the repository for architecturally significant files, maintains
# a files.json index, and generates architecture documentation index.
#
# Usage: .agents/skills/architecture-scanner/scan.sh [--discover | --manifest | --full | --stale | --index]
#   --discover  Scan repo, create/update files.json (preserves user-set priorities)
#   --manifest  Print JSON array of non-low files to document (full scan)
#   --full      Alias for --manifest
#   --stale     Print manifest of files changed since last architecture commit (incremental)
#   --index     Generate .agents/architecture/architecture.index.md from existing docs

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
ARCH_DIR="$REPO_ROOT/.agents/architecture"
SKILL_DIR="$REPO_ROOT/.agents/skills/architecture-scanner"
FILES_JSON="$SKILL_DIR/files.json"

# ── Discovery rules ──────────────────────────────────────────
# Maps glob patterns to category|default_importance.
# Globs are evaluated relative to REPO_ROOT.
# Order matters: first match wins for a given file.
DISCOVERY_RULES=(
  # Config files at root
  "config|high|vite.config.js"
  "config|low|eslint.config.js"
  "config|high|package.json"
  "config|high|packages/*/package.json"

  # Entry points
  "entry|high|src/index.jsx"
  "entry|low|index.html"

  # App shell
  "routing|high|src/pages/_app.jsx"

  # Templates (capitalized JSX in templates/)
  "template|low|src/templates/*/[A-Z]*.jsx"

  # Hypercanvas core package
  "hypercanvas|high|packages/core/src/index.js"
  "hypercanvas|high|packages/core/src/loader.js"
  "hypercanvas|high|packages/core/src/*.js"

  # Hypercanvas react package
  "hypercanvas|high|packages/react/src/index.js"
  "hypercanvas|high|packages/react/src/context.jsx"
  "hypercanvas|high|packages/react/src/StoryboardContext.js"
  "hypercanvas|high|packages/react/src/hashPreserver.js"
  "hypercanvas|high|packages/react/src/hooks/*.js"
  "hypercanvas|medium|packages/react/src/context/FormContext.js"
  "hypercanvas|high|packages/react/src/vite/data-plugin.js"

  # Hypercanvas primer package
  "hypercanvas|high|packages/react-primer/src/index.js"
  "hypercanvas|medium|packages/react-primer/src/[A-Z]*.jsx"
  "hypercanvas|high|packages/react-primer/src/DevTools/DevTools.jsx"

  # Hypercanvas reshaped package
  "hypercanvas|medium|packages/react-reshaped/src/index.js"
  "hypercanvas|low|packages/react-reshaped/src/[A-Z]*.jsx"

  # Tiny canvas package
  "hypercanvas|high|packages/tiny-canvas/src/index.js"
  "hypercanvas|medium|packages/tiny-canvas/src/*.jsx"
  "hypercanvas|medium|packages/tiny-canvas/src/*.js"

  # Shared components (each in its own directory)
  "component|low|src/components/*/[A-Z]*.jsx"

  # Page routes
  "page|low|src/pages/[A-Z]*.jsx"
  "page|medium|src/pages/index.jsx"

  # Global styles
  "style|low|src/globals.css"
  "style|low|src/reset.css"
)

# ── Helpers ──────────────────────────────────────────────────

# Read existing importance for a path from files.json, or return empty string
get_existing_importance() {
  local filepath="$1"
  if [ -f "$FILES_JSON" ]; then
    # Use python3 for reliable JSON parsing
    python3 -c "
import json, sys
with open('$FILES_JSON') as f:
    data = json.load(f)
files = data.get('files', data) if isinstance(data, dict) else data
for entry in files:
    if entry['path'] == '$filepath':
        print(entry.get('importance', ''))
        sys.exit(0)
print('')
" 2>/dev/null
  fi
}

discover_files() {
  # Collect discovered files
  declare -A seen
  declare -A discovered_cat
  declare -A discovered_imp
  local ordered_paths=()

  for rule in "${DISCOVERY_RULES[@]}"; do
    IFS='|' read -r category importance glob_pattern <<< "$rule"
    for file in $REPO_ROOT/$glob_pattern; do
      [ -f "$file" ] || continue
      local relpath="${file#$REPO_ROOT/}"
      if [[ -n "${seen[$relpath]+x}" ]]; then
        continue
      fi
      seen[$relpath]=1
      discovered_cat[$relpath]="$category"
      discovered_imp[$relpath]="$importance"
      ordered_paths+=("$relpath")
    done
  done

  # Build new files.json, preserving existing importance values and categories
  local tmp_json
  tmp_json="$(mktemp)"

  # Preserve existing categories array if present
  python3 -c "
import json
try:
    with open('$FILES_JSON') as f:
        data = json.load(f)
    if isinstance(data, dict) and 'categories' in data:
        print(json.dumps(data['categories'], indent=4))
    else:
        print('null')
except:
    print('null')
" > "${tmp_json}.cats"

  local cats
  cats="$(cat "${tmp_json}.cats")"
  rm -f "${tmp_json}.cats"

  if [ "$cats" = "null" ]; then
    echo "{" > "$tmp_json"
    echo '  "files": [' >> "$tmp_json"
  else
    echo "{" > "$tmp_json"
    echo '  "categories": '"$cats"',' >> "$tmp_json"
    echo '  "files": [' >> "$tmp_json"
  fi

  local first=true
  for relpath in "${ordered_paths[@]}"; do
    local category="${discovered_cat[$relpath]}"
    local default_importance="${discovered_imp[$relpath]}"

    # Preserve user-set importance if file already exists in files.json
    local existing_importance
    existing_importance="$(get_existing_importance "$relpath")"
    local importance="${existing_importance:-$default_importance}"

    if [ "$first" = true ]; then
      first=false
    else
      echo "," >> "$tmp_json"
    fi
    printf '    { "path": "%s", "category": "%s", "importance": "%s" }' \
      "$relpath" "$category" "$importance" >> "$tmp_json"
  done

  echo "" >> "$tmp_json"
  echo "  ]" >> "$tmp_json"
  echo "}" >> "$tmp_json"

  mkdir -p "$SKILL_DIR"
  mv "$tmp_json" "$FILES_JSON"

  # Report what was found
  echo "Discovered ${#ordered_paths[@]} files. Index updated:"
  echo "  $FILES_JSON"
  echo ""
  echo "Files:"
  for relpath in "${ordered_paths[@]}"; do
    local category="${discovered_cat[$relpath]}"
    local existing_importance
    existing_importance="$(get_existing_importance "$relpath")"
    local importance="$existing_importance"
    printf "  %-12s %-6s %s\n" "[$category]" "$importance" "$relpath"
  done
}

print_manifest() {
  if [ ! -f "$FILES_JSON" ]; then
    echo "files.json not found. Run --discover first." >&2
    exit 1
  fi
  python3 -c "
import json
with open('$FILES_JSON') as f:
    data = json.load(f)
files = data.get('files', data) if isinstance(data, dict) else data
categories = data.get('categories', []) if isinstance(data, dict) else []
cat_map = {c['id']: c for c in categories}
out = [e for e in files if e.get('importance') != 'low']
for e in out:
    e['doc'] = e['path'] + '.md'
    cat = cat_map.get(e.get('category'), {})
    e['category_priority'] = cat.get('priority', 'normal')
print(json.dumps(out, indent=2))
"
}

print_stale() {
  if [ ! -f "$FILES_JSON" ]; then
    echo "files.json not found. Run --discover first." >&2
    exit 1
  fi
  python3 -c "
import json, os, subprocess, sys

files_json = '$FILES_JSON'
arch_dir = '$ARCH_DIR'
repo_root = '$REPO_ROOT'
index_file = os.path.join(arch_dir, 'architecture.index.md')

with open(files_json) as f:
    data = json.load(f)

files = data.get('files', data) if isinstance(data, dict) else data
categories = data.get('categories', []) if isinstance(data, dict) else []
cat_map = {c['id']: c for c in categories}

def git_name_only(args):
    try:
        out = subprocess.check_output(args, cwd=repo_root, text=True).strip()
    except subprocess.CalledProcessError:
        return set()
    return set(out.splitlines()) if out else set()

# Find the most recent commit that touched .agents/architecture/
try:
    last_arch_commit = subprocess.check_output(
        ['git', 'log', '-1', '--format=%H', '--', '.agents/architecture/'],
        cwd=repo_root, text=True
    ).strip()
except subprocess.CalledProcessError:
    last_arch_commit = ''

# Get list of source files changed since that commit (or all if no commit)
changed_files = set()
if last_arch_commit:
    changed_files.update(git_name_only(['git', 'diff', '--name-only', last_arch_commit, 'HEAD']))
    # Also include uncommitted changes (staged + unstaged)
    changed_files.update(git_name_only(['git', 'diff', '--name-only', 'HEAD']))
    changed_files.update(git_name_only(['git', 'diff', '--name-only', '--cached']))

tracked = [e for e in files if e.get('importance') != 'low']
tracked_paths = {e['path'] for e in tracked}

results = []
removed = []
removed_docs = set()
total_non_low_existing = 0

for entry in tracked:
    src_rel = entry['path']
    src = os.path.join(repo_root, src_rel)
    doc_rel = src_rel + '.md'
    doc = os.path.join(arch_dir, doc_rel)
    cat = cat_map.get(entry.get('category'), {})
    category_priority = cat.get('priority', 'normal')

    if os.path.isfile(src):
        total_non_low_existing += 1
        status = None
        if not os.path.isfile(doc):
            status = 'missing'
        elif not last_arch_commit:
            # No architecture commits exist yet — everything is stale
            status = 'stale'
        elif src_rel in changed_files:
            status = 'stale'

        if status:
            e = {**entry, 'doc': doc_rel, 'status': status, 'category_priority': category_priority}
            if status == 'missing' and src_rel in changed_files:
                e['change_type'] = 'added'
            results.append(e)
    elif os.path.isfile(doc):
        removed.append({
            **entry,
            'doc': doc_rel,
            'status': 'removed',
            'reason': 'source_deleted',
            'category_priority': category_priority
        })
        removed_docs.add(doc_rel)

# Find orphan docs for deleted/moved/untracked source files.
for root, _, filenames in os.walk(arch_dir):
    for name in filenames:
        if not name.endswith('.md') or name == 'architecture.index.md':
            continue
        doc_abs = os.path.join(root, name)
        doc_rel = os.path.relpath(doc_abs, arch_dir).replace(os.sep, '/')
        if doc_rel in removed_docs:
            continue
        src_rel = doc_rel[:-3]
        src = os.path.join(repo_root, src_rel)
        if src_rel not in tracked_paths:
            reason = 'untracked_source' if os.path.isfile(src) else 'source_deleted_or_moved'
            removed.append({
                'path': src_rel,
                'doc': doc_rel,
                'status': 'removed',
                'reason': reason
            })
            removed_docs.add(doc_rel)

index_reasons = []
if not os.path.isfile(index_file):
    index_reasons.append('index_missing')
if results or removed:
    index_reasons.append('assets_changed')
if '.agents/skills/architecture-scanner/files.json' in changed_files:
    index_reasons.append('category_config_changed')
if any(
    p.startswith('.agents/architecture/')
    and p != '.agents/architecture/architecture.index.md'
    for p in changed_files
):
    index_reasons.append('docs_changed')

output = {
    'index': {
        'status': 'stale' if index_reasons else 'fresh',
        'reasons': index_reasons
    },
    'files': results,
    'removed': removed
}

# Suggest full scan if >50% of existing non-low files need regeneration.
if total_non_low_existing > 0 and len(results) > total_non_low_existing * 0.5:
    output['suggestion'] = 'full_scan'
    output['message'] = (
        f'{len(results)} of {total_non_low_existing} documented files need updates. '
        'Consider running --manifest (or --full) for a full scan instead.'
    )

print(json.dumps(output, indent=2))
"
}

generate_index() {
  mkdir -p "$ARCH_DIR"
  local index_file="$ARCH_DIR/architecture.index.md"

  # Read category order and names from files.json, falling back to defaults
  local category_data
  category_data="$(python3 -c "
import json
with open('$FILES_JSON') as f:
    data = json.load(f)
categories = data.get('categories', []) if isinstance(data, dict) else []
if categories:
    cats = sorted(categories, key=lambda c: c.get('order', 99))
    for c in cats:
        print(c['id'] + '|' + c.get('name', c['id']) + '|' + c.get('priority', 'normal'))
else:
    for pair in [('config','Configuration','normal'),('entry','Entry Points','normal'),('routing','Routing','normal'),('template','Templates','normal'),('hypercanvas','Hypercanvas System','normal'),('component','Shared Components','normal'),('page','Pages','normal'),('data','Data Files','normal'),('style','Global Styles','normal')]:
        print('|'.join(pair))
" 2>/dev/null)"

  cat > "$index_file" << 'HEADER'
# Architecture Index

> Auto-generated documentation of architecturally significant files.
> Run `scan the codebase architecture` to regenerate.

HEADER

  while IFS='|' read -r cat cat_name cat_priority; do
    local has_files=false
    while IFS= read -r doc; do
      [ -f "$doc" ] || continue
      [[ "$doc" == */architecture.index.md ]] && continue
      if grep -q "^category: $cat" "$doc" 2>/dev/null; then
        if [ "$has_files" = false ]; then
          echo "## ${cat_name}" >> "$index_file"
          echo "" >> "$index_file"
          has_files=true
        fi
        local relpath="${doc#$ARCH_DIR/}"
        local title="$(head -1 "$doc" | sed 's/^# //')"
        echo "- [$title](./$relpath)" >> "$index_file"
      fi
    done < <(find "$ARCH_DIR" -name "*.md" -not -name "architecture.index.md" | sort)
    if [ "$has_files" = true ]; then
      echo "" >> "$index_file"
    fi
  done <<< "$category_data"

  echo "Generated: $index_file"
}

case "${1:-}" in
  --discover)
    discover_files
    ;;
  --manifest|--full)
    print_manifest
    ;;
  --stale)
    print_stale
    ;;
  --index)
    generate_index
    ;;
  *)
    echo "Usage: $0 [--discover | --manifest | --full | --stale | --index]"
    echo "  --discover  Scan repo and create/update files.json (preserves priorities)"
    echo "  --manifest  Print JSON manifest of non-low files to document (full scan)"
    echo "  --full      Alias for --manifest"
    echo "  --stale     Print manifest of files changed since last architecture commit (incremental)"
    echo "  --index     Generate architecture index from existing docs"
    exit 1
    ;;
esac
