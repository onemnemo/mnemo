import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, readRepoText, resolves } from "@/i18n/test-bundle"

const SOURCE = readRepoText("mnemo-web", "src", "app", "BetaNotice.tsx")
const KEYS = [...SOURCE.matchAll(/t\("(App|Settings|Common)", "([A-Za-z0-9_.]+)"/g)].map(
  (match) => [match[1], match[2]] as const,
)
const NOTICE_KEYS = KEYS.filter(([namespace]) => namespace === "App").map(([, key]) => key)
const LANGUAGES = ["en", "de", "es", "ja", "nb"] as const

function appNamespace(language: string): Record<string, string> {
  const bundle = JSON.parse(readRepoText("Mnemo.Infrastructure", "Languages", `${language}.json`)) as {
    App?: Record<string, string>
  }
  return bundle.App ?? {}
}

describe("Beta notice translations", () => {
  const bundle = mergedEnglishBundle()

  it("reads every string through a key", () => {
    expect(KEYS).toContainEqual(["App", "BetaNoticeTitle"])
    expect(KEYS).toContainEqual(["App", "BetaNoticeBadge"])
    expect(KEYS).toContainEqual(["Settings", "BackUpMnemo"])
    expect(KEYS).toContainEqual(["Common", "Continue"])
    expect(NOTICE_KEYS.length).toBeGreaterThanOrEqual(5)
  })

  it.each(KEYS)("resolves %s/%s", (namespace, key) => {
    expect(resolves(bundle, namespace, key), `${namespace}/${key} is missing from the merged bundle`).toBe(true)
  })

  it.each(LANGUAGES)("carries every notice key in %s", (language) => {
    const app = appNamespace(language)
    for (const key of NOTICE_KEYS) expect(app[key], `${language} is missing App/${key}`).toBeTypeOf("string")
  })

  it("leaves the version to the running build and keeps dashes out of the copy", () => {
    expect(bundle.App?.BetaNoticeBadge).toContain("{version}")
    for (const language of LANGUAGES) {
      const app = appNamespace(language)
      for (const key of NOTICE_KEYS) expect(app[key], `${language} App/${key}`).not.toMatch(/[\u2013\u2014]/)
    }
  })
})
