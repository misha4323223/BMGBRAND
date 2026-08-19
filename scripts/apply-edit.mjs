#!/usr/bin/env node
/**
 * scripts/apply-edit.mjs
 *
 * Lightweight, byte-exact string replacer for files that the built-in edit
 * tools cannot reach (they only search the first ~64 KB of a file).
 *
 * Why it exists: `str_replace` silently returns "not found" for deep lines in
 * big files (server/routes.ts ~776 KB, client/src/pages/ProductList.tsx
 * ~122 KB). This script reads the whole file and applies precise replacements
 * guarded by an occurrence-count check, so it never silently mis-edits.
 *
 * Usage:
 *   node scripts/apply-edit.mjs <patch.json>            # apply patches
 *   node scripts/apply-edit.mjs --check <patch.json>    # count only, write nothing
 *
 * patch.json format:
 *   {
 *     "patches": [
 *       { "path": "server/routes.ts", "old": "old text", "new": "new text", "count": 1 }
 *     ]
 *   }
 *   - "old" / "new": exact UTF-8 strings (any characters, incl. newlines).
 *   - "count": expected number of occurrences of "old" (default 1).
 *     If the actual count differs, that patch is SKIPPED with an error and the
 *     file is left untouched for that patch.
 */

import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const checkOnly = argv[0] === "--check";
const patchFile = checkOnly ? argv[1] : argv[0];

if (!patchFile) {
  console.error("Usage: node scripts/apply-edit.mjs [--check] <patch.json>");
  process.exit(2);
}

let spec;
try {
  spec = JSON.parse(readFileSync(patchFile, "utf8"));
} catch (err) {
  console.error(`Cannot read/parse ${patchFile}: ${err.message}`);
  process.exit(1);
}

const patches = spec?.patches;
if (!Array.isArray(patches) || patches.length === 0) {
  console.error(`${patchFile}: expected { "patches": [ ... ] }`);
  process.exit(1);
}

let failures = 0;
for (const patch of patches) {
  const path = patch?.path;
  const oldStr = patch?.old;
  const newStr = patch?.new;
  const expected = typeof patch?.count === "number" ? patch.count : 1;

  if (!path || typeof oldStr !== "string" || typeof newStr !== "string") {
    console.error(`SKIP: bad patch entry: ${JSON.stringify(patch)}`);
    failures += 1;
    continue;
  }
  if (oldStr === "") {
    console.error(`SKIP ${path}: "old" must not be empty`);
    failures += 1;
    continue;
  }
  if (!Number.isInteger(expected) || expected < 0) {
    console.error(`SKIP ${path}: "count" must be a non-negative integer`);
    failures += 1;
    continue;
  }

  let data;
  try {
    data = readFileSync(path, "utf8");
  } catch (err) {
    console.error(`SKIP ${path}: cannot read (${err.message})`);
    failures += 1;
    continue;
  }

  const occurrences = data.split(oldStr).length - 1;
  if (occurrences !== expected) {
    console.error(
      `ABORT ${path}: found ${occurrences} occurrence(s), expected ${expected}. No change written.`,
    );
    failures += 1;
    continue;
  }

  if (checkOnly) {
    console.log(`CHECK ${path}: ${occurrences} occurrence(s) of ${JSON.stringify(oldStr)}`);
    continue;
  }

  writeFileSync(path, data.replaceAll(oldStr, newStr), "utf8");
  console.log(`OK ${path}: replaced ${occurrences} occurrence(s)`);
}

process.exit(failures === 0 ? 0 : 1);
