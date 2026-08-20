// @vitest-environment jsdom

/**
 * A rejected file's row used to show the server's raw English warning string verbatim. Now the
 * server sends a translation key and its values, and the row resolves them through the real
 * `useT`/`useI18nStore`. This mounts the panel against a German bundle read straight from
 * Mnemo.Infrastructure/Languages/de.json, the same file the Host serves to the browser, so a
 * drift between the code's key and the shipped translation fails here rather than in production.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { TransferFormatDto } from "@/api/types"
import { useI18nStore } from "@/i18n/store"

import type { QueuedFile } from "../transfer"
import { ImportPanel } from "./ImportPanel"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Read with plain node:fs rather than the import.meta.url trick i18n/test-bundle.ts uses: that
// trick resolves to a non-file URL once this file runs under the jsdom environment, which this
// suite needs for `document`. process.cwd() is mnemo-web for every documented way this suite runs.
const LANGUAGES_DIR = path.resolve(process.cwd(), "..", "Mnemo.Infrastructure", "Languages")
const GERMAN_TRANSFER_WARNINGS = (
  JSON.parse(readFileSync(path.join(LANGUAGES_DIR, "de.json"), "utf8")) as {
    TransferWarnings: Record<string, string>
  }
).TransferWarnings

const FORMATS: TransferFormatDto[] = [
  {
    formatId: "flashcards.anki",
    displayName: "Anki Package (.apkg)",
    extensions: [".apkg"],
    supportsImport: true,
    supportsExport: true,
    supportsConflictPolicy: false,
  },
]

let container: HTMLElement
let root: Root

beforeEach(() => {
  useI18nStore.setState({ bundle: { TransferWarnings: GERMAN_TRANSFER_WARNINGS } })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useI18nStore.setState({ bundle: {} })
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

describe("the flashcards import panel", () => {
  it("resolves a rejected file's server warning through the active German bundle", () => {
    const queue: QueuedFile[] = [
      {
        key: "row-1",
        name: "deck.apkg",
        sizeBytes: 2048,
        status: "rejected",
        formatId: "flashcards.anki",
        formatName: "Anki Package (.apkg)",
        notes: [{ key: "AnkiPackageUnreadable", params: { error: "beschädigte Datei" } }],
      },
    ]

    mount(
      <ImportPanel
        queue={queue}
        formats={FORMATS}
        rejected={[]}
        conflict="KeepBoth"
        busy={false}
        ready
        onAddFiles={() => {}}
        onRemove={() => {}}
        onConflictChange={() => {}}
      />,
    )

    const expected = GERMAN_TRANSFER_WARNINGS.AnkiPackageUnreadable.replace("{error}", "beschädigte Datei")
    expect(expected).toBe("Das Anki-Paket konnte nicht gelesen werden: beschädigte Datei")
    expect(container.textContent).toContain(expected)
    // The raw key never reaches the screen: a miss would show it literally, so this also
    // proves the lookup found a real entry rather than falling back silently.
    expect(container.textContent).not.toContain("AnkiPackageUnreadable")
  })
})
