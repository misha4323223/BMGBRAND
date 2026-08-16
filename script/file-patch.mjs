#!/usr/bin/env node
/**
 * script/file-patch.mjs — deterministic anchor-based file patcher.
 *
 * Why: the in-IDE file editor can silently miss matches deep inside very large
 * files (e.g. server/routes.ts, server/storage.ts). This tool edits any file by
 * exact anchor text, refuses to run when the anchor is ambiguous or missing, and
 * reports exactly what it changed. It is the permanent replacement for ad-hoc
 * deep edits.
 *
 * Usage:
 *   node script/file-patch.mjs <file> <anchor-file> <insert-file> after|before|replace
 *
 *   <file>         — target file (path relative to repo root)
 *   <anchor-file>  — file containing the exact anchor text (must occur ONCE)
 *   <insert-file>  — file containing the text to insert (or empty file for delete)
 *   after|before   — insert after or before the anchor
 *   replace        — replace the anchor with the insert text (use empty insert to delete)
 *
 * Exit codes: 0 = patched, 2 = anchor missing/ambiguous, 1 = other error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [file, anchorFile, insertFile, mode] = process.argv.slice(2);
if (!file || !anchorFile || !insertFile || !["after", "before", "replace"].includes(mode)) {
  console.error("Usage: node script/file-patch.mjs <file> <anchor-file> <insert-file> after|before|replace");
  process.exit(1);
}

const target = readFileSync(resolve(file), "utf8");
const anchor = readFileSync(resolve(anchorFile), "utf8").replace(/\n$/, "");
const insert = readFileSync(resolve(insertFile), "utf8").replace(/\n$/, "");

const count = target.split(anchor).length - 1;
if (count === 0) {
  console.error(`[file-patch] ANCHOR NOT FOUND in ${file}`);
  process.exit(2);
}
if (count > 1) {
  console.error(`[file-patch] ANCHOR AMBIGUOUS: ${count} occurrences in ${file} — refusing`);
  process.exit(2);
}

const at = target.indexOf(anchor);
let patched;
if (mode === "replace") {
  patched = target.slice(0, at) + insert + target.slice(at + anchor.length);
} else if (mode === "after") {
  patched = target.slice(0, at + anchor.length) + "\n" + insert + target.slice(at + anchor.length);
} else {
  patched = target.slice(0, at) + insert + "\n" + anchor + target.slice(at + anchor.length);
}

writeFileSync(resolve(file), patched);
console.log(`[file-patch] OK: inserted ${insert.length} chars ${mode} anchor (1 occurrence) in ${file}`);
