// Test-only: the Mindmap namespace as the host merges it, shared file first and the module's own on
// top. Read with node:fs from the working directory, since import.meta.url is not a file URL under
// jsdom; process.cwd() is mnemo-web for every documented way the suite runs.
import { readFileSync } from "node:fs"
import path from "node:path"

function read(...segments: string[]): Record<string, string> {
  const file = path.resolve(process.cwd(), "..", "Mnemo.Infrastructure", ...segments)
  return (JSON.parse(readFileSync(file, "utf8")) as { Mindmap: Record<string, string> }).Mindmap
}

export function englishMindmap(): Record<string, string> {
  return { ...read("Languages", "en.json"), ...read("Modules", "Mindmap", "Translations", "en.json") }
}
