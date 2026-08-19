#!/usr/bin/env node
// Scans every tracked source file for an embedded NUL byte. A stray NUL is almost always a sign
// that something went wrong on the way into the repository, a bad encoding conversion or a tool
// that mangled a save, and it can make a source file behave unpredictably in editors, diffs and
// some parsers. `git grep -I` cannot find this on its own: it uses the same NUL sniff to decide a
// file is binary and skips it, so the one tool built to search the tree quietly excuses the file
// that would fail this check.
//
// A handful of files carry a NUL byte on purpose, as a real character inside a string rather than
// stray bytes, and are listed below with the reason. Anything else that trips the scan is treated
// as a mistake.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEXT_EXTENSIONS = new Set([
  ".cs", ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
  ".json", ".yml", ".yaml", ".css", ".html", ".xml", ".svg",
  ".md", ".sln", ".csproj", ".props", ".targets", ".config", ".manifest",
  ".editorconfig", ".gitignore", ".gitattributes",
  ".sh", ".ps1", ".bat", ".txt", ".toml", ".typ", ".aff", ".dic",
]);

const ALLOWED = new Map([
  [
    "mnemo-web/src/mindmap/library/shelf.ts",
    "a NUL-prefixed sentinel folder id that can never collide with a real one",
  ],
  [
    "mnemo-web/src/notes/editor/mapper/generate.ts",
    "a control character in the fixture generator's deliberately awkward text samples",
  ],
]);

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { maxBuffer: 1024 * 1024 * 64 });
  return output.toString("utf8").split("\0").filter(Boolean);
}

function extensionOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

let scanned = 0;
const offenders = [];

for (const path of trackedFiles()) {
  if (!TEXT_EXTENSIONS.has(extensionOf(path))) continue;
  scanned += 1;

  const bytes = readFileSync(path);
  if (!bytes.includes(0)) continue;
  if (ALLOWED.has(path)) continue;

  offenders.push(path);
}

console.log(`scanned ${scanned} tracked source files for NUL bytes`);

if (offenders.length > 0) {
  for (const path of offenders) {
    console.error(`NUL byte found in ${path}`);
  }
  console.error(
    `${offenders.length} file(s) carry an unexpected NUL byte. If this one is deliberate, add it to ALLOWED in scripts/check-nul-bytes.mjs with the reason.`,
  );
  process.exit(1);
}

console.log("no unexpected NUL bytes found");
