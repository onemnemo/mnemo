// Test-only helper: reconstructs the merged translation bundle straight from the
// repository's JSON files, the way Mnemo.Host/I18n/TranslationBundleService merges
// them for the SPA (namespaces accumulate across sources, a later source's key wins
// within a namespace). Lets a component's test assert that the (namespace, key)
// pairs it reads actually resolve, instead of trusting that whoever wired up a
// namespace string got it right.
//
// English only: TranslationBundleTests (Mnemo.Infrastructure.Tests) already guards
// that every other language carries every key English does, so a key present here
// is present everywhere.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type Bundle = Record<string, Record<string, string>>

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

export function repoFile(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments)
}

export function readRepoText(...segments: string[]): string {
  return readFileSync(repoFile(...segments), "utf8")
}

function readJsonBundle(file: string): Bundle {
  return JSON.parse(readFileSync(file, "utf8")) as Bundle
}

/** Every Translations/en.json under Mnemo.Infrastructure/Modules, found by walking the tree. */
export function findModuleEnglishBundles(): string[] {
  const modulesDir = repoFile("Mnemo.Infrastructure", "Modules")
  const found: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (!statSync(full).isDirectory()) continue
      if (entry === "Translations") {
        const enFile = path.join(full, "en.json")
        try {
          statSync(enFile)
          found.push(enFile)
        } catch {
          // A Translations folder with no en.json is its own problem, not this one's.
        }
      } else {
        walk(full)
      }
    }
  }

  walk(modulesDir)
  return found
}

/**
 * The merged English bundle every mnemo-web surface actually reads: the built-in
 * source (Mnemo.Infrastructure/Languages) plus every module's own Translations
 * folder, namespace by namespace, mirroring TranslationBundleService.MergeIntoAsync.
 */
export function mergedEnglishBundle(): Bundle {
  const files = [repoFile("Mnemo.Infrastructure", "Languages", "en.json"), ...findModuleEnglishBundles()]

  const merged: Bundle = {}
  for (const file of files) {
    const data = readJsonBundle(file)
    for (const [ns, entries] of Object.entries(data)) {
      merged[ns] ??= {}
      Object.assign(merged[ns], entries)
    }
  }
  return merged
}

export function resolves(bundle: Bundle, ns: string, key: string): boolean {
  return bundle[ns]?.[key] !== undefined
}
