import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, readRepoText, resolves } from "@/i18n/test-bundle"

const PAGE = readRepoText("mnemo-web", "src", "settings", "components", "pages", "StorageDataPage.tsx")
const SCHEMA = readRepoText("mnemo-web", "src", "settings", "schema.ts")

const DIRECT_KEYS = [...PAGE.matchAll(/t\("(Settings|Common|Errors)", "([A-Za-z0-9_.]+)"/g)].map(
  (match) => [match[1], match[2]] as const,
)

const DYNAMIC_SETTINGS_KEYS = [
  "BackingUp",
  "BackUp",
  "InspectingBackup",
  "ChooseBackup",
  "PreparingRestore",
  "RestoreBackup",
  "BackupThisCollection",
  "BackupOtherCollection",
  "FolderMissing",
  "FolderOpenFailed",
  "RestoreDiscardedInstanceRunning",
  "RestoreDiscardedRequestInvalid",
] as const

function schemaKeys(source: string): string[] {
  const category = /\{\s*id: "Storage",[\s\S]*?\},\s*\n\n/.exec(source.replace(/\r\n/g, "\n"))?.[0] ?? ""
  return [...category.matchAll(/(?:title|subtitle): "([A-Za-z0-9_.]+)"/g)].map((match) => match[1])
}

const KEYS = [
  ...DIRECT_KEYS,
  ...DYNAMIC_SETTINGS_KEYS.map((key) => ["Settings", key] as const),
  ...schemaKeys(SCHEMA).map((key) => ["Settings", key] as const),
]

describe("Storage and data translations", () => {
  const bundle = mergedEnglishBundle()

  it("finds the page and navigation keys", () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(35)
    expect(KEYS).toContainEqual(["Settings", "StorageSubtitle"])
    expect(KEYS).toContainEqual(["Settings", "RestoreComplete"])
  })

  it.each(KEYS)("resolves %s/%s", (namespace, key) => {
    expect(resolves(bundle, namespace, key), `${namespace}/${key} is missing from the merged bundle`).toBe(true)
  })

  it("describes the full data surface without calling it a profile", () => {
    expect(bundle.Settings?.StorageSubtitle).toBe("Your data folder, backups, and restoring from one.")
    expect(bundle.Settings?.RestoreConfirmTitle).toBe("Replace everything in Mnemo?")
    expect(bundle.Settings?.RestoreConfirmTitle).not.toContain("profile")
  })
})
