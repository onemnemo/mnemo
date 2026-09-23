import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { areas } from "./code-map-areas.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".cs", ".ts", ".tsx", ".js", ".mjs", ".css", ".json"]);
const layerOrder = ["web", "host", "core", "infrastructure", "tests"];

function usage() {
  console.log("Usage: node scripts/code-map.mjs <area> [--topic <literal>] [--limit <per-layer count>]");
  console.log("       node scripts/code-map.mjs --list");
  console.log("       node scripts/code-map.mjs --check");
}

function parseArguments(args) {
  const options = { area: null, topic: null, limit: 2, list: false, check: false, help: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--list") {
      options.list = true;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--topic") {
      options.topic = args[++i];
      if (!options.topic?.trim()) throw new Error("--topic needs a nonempty literal.");
    } else if (arg === "--limit") {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        throw new Error("--limit must be an integer from 1 to 20.");
      }
      options.limit = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.area) {
      throw new Error(`Unexpected argument: ${arg}`);
    } else {
      options.area = arg.toLowerCase();
    }
  }

  return options;
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim() ?? "Could not list repository files.");
  }
  return [...new Set(result.stdout.split("\0").filter(Boolean))].sort();
}

function matchesScope(file, scope) {
  return file === scope || file.startsWith(scope);
}

function filesForScopes(files, scopes) {
  return files.filter((file) => scopes.some((scope) => matchesScope(file, scope)));
}

function validateCatalog(files) {
  const errors = [];
  const names = new Map();
  let scopeCount = 0;
  let startCount = 0;

  for (const [areaName, area] of Object.entries(areas)) {
    for (const name of [areaName, ...area.aliases]) {
      const normalized = name.toLowerCase();
      if (names.has(normalized)) errors.push(`${name}: also used by ${names.get(normalized)}`);
      names.set(normalized, areaName);
    }

    const scopes = Object.values(area.layers).flat();
    for (const scope of scopes) {
      scopeCount += 1;
      if (!files.some((file) => matchesScope(file, scope))) {
        errors.push(`${areaName}: empty scope ${scope}`);
      }
    }
    for (const start of area.start) {
      startCount += 1;
      if (!files.includes(start)) errors.push(`${areaName}: missing entry point ${start}`);
      if (!scopes.some((scope) => matchesScope(start, scope))) {
        errors.push(`${areaName}: entry point outside its scopes ${start}`);
      }
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(error);
    throw new Error(`${errors.length} catalog issue${errors.length === 1 ? "" : "s"}.`);
  }
  console.log(`Valid: ${Object.keys(areas).length} areas, ${scopeCount} scopes, ${startCount} entry points.`);
}

function resolveArea(name) {
  if (areas[name]) return [name, areas[name]];
  const match = Object.entries(areas).find(([, area]) => area.aliases.includes(name));
  if (match) return match;
  throw new Error(`Unknown area: ${name}. Run --list for available areas.`);
}

function renderScope(areaName, area, files) {
  console.log(`area: ${areaName}`);
  for (const layer of layerOrder) {
    const scopes = area.layers[layer];
    if (!scopes) continue;
    const summary = scopes.map((scope) => `${scope} (${files.filter((file) => matchesScope(file, scope)).length})`);
    console.log(`${layer}: ${summary.join(", ")}`);
  }
  console.log("start:");
  for (const file of area.start) console.log(`  ${file}`);
}

function renderTopic(area, files, topic, limit) {
  const term = topic.toLowerCase();
  const startFiles = new Set(area.start);
  let total = 0;
  let skipped = 0;
  const output = [];

  for (const layer of layerOrder) {
    const scopes = area.layers[layer];
    if (!scopes) continue;
    const matches = [];
    for (const file of filesForScopes(files, scopes)) {
      if (!sourceExtensions.has(extname(file).toLowerCase())) continue;
      const nameMatch = file.toLowerCase().includes(term);
      let textMatch = false;
      try {
        textMatch = readFileSync(resolve(root, file), "utf8").toLowerCase().includes(term);
      } catch {
        skipped += 1;
      }
      if (nameMatch || textMatch) {
        const isTest = /(^|\/)[^/]+\.test\.[^/]+$/.test(file) || file.includes("/Tests/");
        const rank = (nameMatch ? 4 : 0) + (startFiles.has(file) ? 2 : 0) - (layer === "tests" || !isTest ? 0 : 1);
        matches.push({ file, rank });
      }
    }

    matches.sort((a, b) => b.rank - a.rank || a.file.localeCompare(b.file));
    total += matches.length;
    if (matches.length) {
      output.push(`${layer}: ${Math.min(limit, matches.length)}/${matches.length} matching files`);
      for (const { file } of matches.slice(0, limit)) output.push(`  ${file}`);
    }
  }

  console.log(`topic: ${topic} (${total} scoped file matches)`);
  for (const line of output) console.log(line);
  if (!total) console.log("No matches in these scopes. Search the current source before concluding absence.");
  if (skipped) console.log(`${skipped} files could not be read. Search those paths directly.`);
  if (total > output.filter((line) => line.startsWith("  ")).length) {
    console.log(`More matches are available with --limit ${Math.min(limit * 2, 20)}.`);
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help || (!options.area && !options.list && !options.check)) {
    usage();
  } else if (options.list) {
    for (const [name, area] of Object.entries(areas)) {
      console.log(`${name}: ${area.aliases.join(", ")}`);
    }
  } else {
    const files = trackedFiles();
    if (options.check) {
      validateCatalog(files);
    } else {
      const [name, area] = resolveArea(options.area);
      renderScope(name, area, files);
      if (options.topic) renderTopic(area, files, options.topic, options.limit);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
