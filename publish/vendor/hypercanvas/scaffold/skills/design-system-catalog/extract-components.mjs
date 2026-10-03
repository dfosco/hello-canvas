#!/usr/bin/env node

/**
 * Universal design system component extractor.
 *
 * Extracts React components from any installed design system package.
 * Primary strategy: parse TypeScript declarations (.d.ts).
 * Secondary: optional runtime import for sub-component enrichment.
 *
 * Usage: node extract-components.mjs <package-name>
 * Output: JSON to stdout
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname, relative, sep } from "path";
import { createRequire } from "module";

// ── Args ────────────────────────────────────────────────────
const packageName = process.argv[2];
if (!packageName) {
  process.stderr.write("Usage: node extract-components.mjs <package-name>\n");
  process.exit(1);
}

// ── Resolve package ─────────────────────────────────────────
const require_ = createRequire(
  join(process.env.REPO_ROOT || process.cwd(), "package.json")
);

let pkgRoot;
try {
  const p = require_.resolve(`${packageName}/package.json`);
  pkgRoot = dirname(p);
} catch {
  const fallback = join(
    process.env.REPO_ROOT || process.cwd(),
    "node_modules",
    ...packageName.split("/")
  );
  if (existsSync(join(fallback, "package.json"))) {
    pkgRoot = fallback;
  } else {
    process.stderr.write(`Error: package "${packageName}" not found.\n`);
    process.exit(1);
  }
}

const pkgJson = JSON.parse(
  readFileSync(join(pkgRoot, "package.json"), "utf-8")
);
const version = pkgJson.version;

// ── Skip lists ──────────────────────────────────────────────

const SKIP_NAMES = new Set([
  "Omit", "Pick", "Partial", "Record", "React", "HTMLElement",
  "PropsWithChildren", "ForwardRefExoticComponent", "FCWithSlotMarker",
  "Provider", "Consumer", "Fragment", "Suspense", "StrictMode",
  "Component", "PureComponent", "Element",
]);

const SKIP_PROPS = new Set([
  "children", "className", "style", "ref", "key", "as",
  "dangerouslySetInnerHTML", "suppressHydrationWarning",
]);

// ── TypeScript declaration parsing (primary) ────────────────

function findTypesEntryPoint() {
  const candidates = [
    pkgJson.types,
    pkgJson.typings,
  ];

  // Crawl the exports map for type entries
  if (pkgJson.exports) {
    const root = pkgJson.exports["."];
    if (typeof root === "string" && root.endsWith(".d.ts")) {
      candidates.push(root);
    } else if (typeof root === "object" && root !== null) {
      candidates.push(
        root.types,
        root.import?.types,
        root.require?.types,
        root.node?.types,
        root.default?.types
      );
    }
  }

  // typesVersions (e.g. {"*": {"*": ["dist/types/*"]}})
  if (pkgJson.typesVersions) {
    for (const range of Object.values(pkgJson.typesVersions)) {
      if (range["*"]) {
        for (const pattern of range["*"]) {
          const resolved = pattern.replace("*", "index");
          candidates.push(resolved);
        }
      }
      if (range["."]) {
        for (const pattern of range["."]) {
          candidates.push(pattern.replace("*", "index"));
        }
      }
    }
  }

  // Common fallback locations
  candidates.push(
    "dist/index.d.ts", "dist/index.d.mts", "dist/index.d.cts",
    "lib/index.d.ts", "index.d.ts", "types/index.d.ts",
    "dist/cjs/index.d.ts", "dist/esm/index.d.ts"
  );

  for (const c of candidates.filter(Boolean)) {
    const resolved = join(pkgRoot, c);
    if (existsSync(resolved)) return resolved;
  }

  // Try DefinitelyTyped (@types/*)
  const typesPackage = packageName.startsWith("@")
    ? `@types/${packageName.slice(1).replace("/", "__")}`
    : `@types/${packageName}`;
  try {
    return require_.resolve(`${typesPackage}/index.d.ts`);
  } catch {
    /* not found */
  }

  return null;
}

function resolveImportPath(fromFile, specifier) {
  const dir = dirname(fromFile);
  for (const ext of [
    ".d.ts", ".d.mts", ".d.cts",
    "/index.d.ts", "/index.d.mts", "/index.d.cts",
  ]) {
    const candidate = join(dir, specifier + ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Walk the export tree starting from entryFile.
 * Returns Map<name, { name, sourceFile }>.
 */
function parseExports(entryFile, depth = 0, visited = new Set()) {
  if (depth > 8 || visited.has(entryFile) || !existsSync(entryFile))
    return new Map();
  visited.add(entryFile);

  const content = readFileSync(entryFile, "utf-8");
  const results = new Map();

  for (const line of content.split("\n")) {
    if (!line.startsWith("export ")) continue;
    if (line.startsWith("export type ")) continue;

    // export * from './path'
    const starMatch = line.match(/export\s*\*\s*from\s*['"]([^'"]+)['"]/);
    if (starMatch) {
      const resolved = resolveImportPath(entryFile, starMatch[1]);
      if (resolved) {
        for (const [k, v] of parseExports(resolved, depth + 1, visited)) {
          if (!results.has(k)) results.set(k, v);
        }
      }
      continue;
    }

    // export { Foo, Bar, default as Baz } from './path'
    const namedFrom = line.match(
      /export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/
    );
    if (namedFrom) {
      const resolved = resolveImportPath(entryFile, namedFrom[2]);
      for (const part of namedFrom[1].split(",").map((s) => s.trim())) {
        if (part.startsWith("type ")) continue;
        let name;
        const asDefault = part.match(/default\s+as\s+(\w+)/);
        const asRename = part.match(/(\w+)\s+as\s+(\w+)/);
        const plain = part.match(/^(\w+)$/);
        if (asDefault) name = asDefault[1];
        else if (asRename) name = asRename[2];
        else if (plain) name = plain[1];
        if (name && /^[A-Z]/.test(name) && !SKIP_NAMES.has(name)) {
          results.set(name, { name, sourceFile: resolved || entryFile });
        }
      }
      continue;
    }

    // export declare const/function/class Foo
    const decl = line.match(
      /export\s+declare\s+(?:const|function|class)\s+([A-Z]\w+)/
    );
    if (decl && !SKIP_NAMES.has(decl[1])) {
      results.set(decl[1], { name: decl[1], sourceFile: entryFile });
    }
  }

  return results;
}

/**
 * Extract sub-components from .d.ts content for a compound component.
 * Handles both property declarations and intersection types.
 */
function extractSubComponentsDts(dtsContent, compName) {
  const subs = [];
  const seen = new Set();

  // Pattern 1: indented property — `    SubName: ...`
  for (const line of dtsContent.split("\n")) {
    const m = line.match(/^\s{2,8}([A-Z][a-zA-Z]+)\s*:/);
    if (m && !SKIP_NAMES.has(m[1]) && !seen.has(m[1])) {
      seen.add(m[1]);
      subs.push(m[1]);
    }
  }

  // Pattern 2: intersection — `typeof X & { Cell: ...; Header: ... }`
  const intersectionRe = /&\s*\{([^}]+)\}/g;
  let im;
  while ((im = intersectionRe.exec(dtsContent)) !== null) {
    const block = im[1];
    const propRe = /([A-Z][a-zA-Z]+)\s*:/g;
    let pm;
    while ((pm = propRe.exec(block)) !== null) {
      if (!SKIP_NAMES.has(pm[1]) && !seen.has(pm[1])) {
        seen.add(pm[1]);
        subs.push(pm[1]);
      }
    }
  }

  return subs;
}

/**
 * Extract props from *Props type/interface definitions.
 */
function extractPropsDts(dtsContent, compName) {
  const props = [];
  const seen = new Set();

  // Match type/interface blocks named {CompName}Props or {CompName}BaseProps
  const patterns = [
    new RegExp(
      `(?:export\\s+)?(?:type|interface)\\s+${compName}(?:Base)?Props[^{]*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`,
      "gs"
    ),
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(dtsContent)) !== null) {
      const block = match[1];
      const propRe =
        /(?:\/\*\*[\s\S]*?\*\/\s*)?['"]?(\w+)['"]?\s*\??\s*:\s*([^;\n]+)/g;
      let pm;
      while ((pm = propRe.exec(block)) !== null) {
        const propName = pm[1];
        let propType = pm[2].trim();
        if (SKIP_PROPS.has(propName)) continue;
        if (propName.startsWith("_")) continue;
        if (seen.has(propName)) continue;
        if (
          /^[A-Z]/.test(propName) &&
          /(?:ForwardRef|FCWith|ExoticComponent|typeof)/.test(propType)
        )
          continue;

        propType = propType.replace(/import\([^)]+\)\./g, "");
        if (propType.length > 80) propType = propType.substring(0, 77) + "...";

        seen.add(propName);
        props.push({ name: propName, type: propType });
      }
    }
  }

  return props;
}

/**
 * Read all relevant .d.ts content for a component.
 */
function readComponentDts(sourceFile, compName) {
  if (!sourceFile || !existsSync(sourceFile)) return "";

  const sources = [];
  sources.push(readFileSync(sourceFile, "utf-8"));

  const dir = dirname(sourceFile);

  // Also check for types.d.ts in same directory
  for (const extra of ["types.d.ts", `${compName}.d.ts`]) {
    const f = join(dir, extra);
    if (existsSync(f) && f !== sourceFile) {
      sources.push(readFileSync(f, "utf-8"));
    }
  }

  return sources.join("\n");
}

// ── Auto-categorization ─────────────────────────────────────

const CATEGORY_MAP = {
  layout: "Layout", layouts: "Layout", grid: "Layout",
  navigation: "Navigation", nav: "Navigation",
  action: "Actions", actions: "Actions", menu: "Actions",
  menus: "Actions", button: "Actions", buttons: "Actions",
  form: "Forms", forms: "Forms", input: "Forms", inputs: "Forms",
  data: "Data Display", display: "Data Display", "data-display": "Data Display",
  feedback: "Feedback",
  overlay: "Overlays", overlays: "Overlays", modal: "Overlays", dialog: "Overlays",
  content: "Content", typography: "Typography",
  utility: "Utilities", utilities: "Utilities",
  general: "General", common: "General",
};

function categorizeFromPath(sourceFile) {
  if (!sourceFile) return "Components";

  const rel = relative(pkgRoot, sourceFile);
  const parts = rel
    .split(sep)
    .filter((p) => !["dist", "lib", "src", "cjs", "esm", "types"].includes(p));

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (CATEGORY_MAP[lower]) return CATEGORY_MAP[lower];
  }

  if (parts.length >= 2) {
    const parentDir = parts[parts.length - 2].toLowerCase();
    if (CATEGORY_MAP[parentDir]) return CATEGORY_MAP[parentDir];
  }

  return "Components";
}

// ── Runtime enrichment (optional, best-effort) ──────────────

async function tryRuntimeEnrichment(components) {
  try {
    const mod = await import(packageName);

    for (const [name, comp] of components) {
      const value = mod[name];
      if (!value) continue;

      // Enrich sub-components from runtime (most reliable for compound components)
      try {
        const runtimeSubs = [];
        for (const [subName, subValue] of Object.entries(value)) {
          if (!/^[A-Z]/.test(subName)) continue;
          if (SKIP_NAMES.has(subName)) continue;
          const isSub =
            typeof subValue === "function" ||
            (typeof subValue === "object" && subValue?.$$typeof != null) ||
            (typeof subValue === "object" &&
              typeof subValue?.render === "function");
          if (isSub) runtimeSubs.push(subName);
        }

        if (runtimeSubs.length > 0) {
          const existing = new Set(comp.subComponents);
          for (const sub of runtimeSubs) {
            if (!existing.has(sub)) comp.subComponents.push(sub);
          }
        }
      } catch {
        /* non-iterable export */
      }
    }

    process.stderr.write("Runtime enrichment: success\n");
  } catch {
    process.stderr.write(
      "Runtime enrichment: skipped (import failed, using .d.ts data only)\n"
    );
  }
}

// ── Build component list ────────────────────────────────────

const typesEntry = findTypesEntryPoint();

if (!typesEntry) {
  process.stderr.write(
    `Error: no TypeScript declarations found for "${packageName}".\n` +
      "Ensure the package ships .d.ts files or install @types/* for it.\n"
  );
  process.exit(1);
}

process.stderr.write(`Types entry: ${relative(pkgRoot, typesEntry)}\n`);

const tsExports = parseExports(typesEntry);

process.stderr.write(
  `Found ${tsExports.size} PascalCase exports in declarations\n`
);

// Build component map from TypeScript exports
const components = new Map();

for (const [name, info] of tsExports) {
  if (name.startsWith("use") || !/^[A-Z]/.test(name)) continue;

  const dtsContent = readComponentDts(info.sourceFile, name);

  components.set(name, {
    name,
    importPath: packageName,
    subComponents: extractSubComponentsDts(dtsContent, name),
    props: extractPropsDts(dtsContent, name),
    category: categorizeFromPath(info.sourceFile),
  });
}

// Try runtime enrichment for sub-components (best-effort)
await tryRuntimeEnrichment(components);

// ── Output ──────────────────────────────────────────────────

const output = {
  packageName,
  version,
  totalComponents: components.size,
  components: [...components.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  ),
};

process.stdout.write(JSON.stringify(output, null, 2) + "\n");
