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

import type { ConflictPolicy, PayloadEvidenceDto, TransferFormatDto } from "@/api/types"
import { hasIcon } from "@/components/icon/icon-registry"
import { useI18nStore } from "@/i18n/store"

import type { QueuedFile } from "../transfer"
import { ImportPanel } from "./ImportPanel"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Read with plain node:fs rather than the import.meta.url trick i18n/test-bundle.ts uses: that
// trick resolves to a non-file URL once this file runs under the jsdom environment, which this
// suite needs for `document`. process.cwd() is mnemo-web for every documented way this suite runs.
const LANGUAGES_DIR = path.resolve(process.cwd(), "..", "Mnemo.Infrastructure", "Languages")
const GERMAN = JSON.parse(readFileSync(path.join(LANGUAGES_DIR, "de.json"), "utf8")) as {
  TransferWarnings: Record<string, string>
  Common: Record<string, string>
}
const GERMAN_TRANSFER_WARNINGS = GERMAN.TransferWarnings
const GERMAN_COMMON = GERMAN.Common

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
  useI18nStore.setState({ bundle: { TransferWarnings: GERMAN_TRANSFER_WARNINGS, Common: GERMAN_COMMON } })
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

    mountPanel(queue, "KeepBoth")

    const expected = GERMAN_TRANSFER_WARNINGS.AnkiPackageUnreadable.replace("{error}", "beschädigte Datei")
    expect(expected).toBe("Das Anki-Paket konnte nicht gelesen werden: beschädigte Datei")
    expect(container.textContent).toContain(expected)
    // The raw key never reaches the screen: a miss would show it literally, so this also
    // proves the lookup found a real entry rather than falling back silently.
    expect(container.textContent).not.toContain("AnkiPackageUnreadable")
  })

  it("says what a package is and how much of it is already here, before anything is imported", () => {
    mountPanel([packageRow()], "KeepBoth")

    expect(container.textContent).toContain(GERMAN_COMMON.TransferEvidenceBackupHere)
    expect(container.textContent).toContain(
      GERMAN_COMMON.TransferEvidenceDecksFormat.replace("{0}", "4"),
    )
    expect(container.textContent).toContain(
      GERMAN_COMMON.TransferEvidenceAlreadyHereFormat.replace("{0}", "3").replace("{1}", "1"),
    )
    expect(container.textContent).toContain(
      GERMAN_COMMON.TransferEvidenceMissingFormat.replace("{0}", "2"),
    )
    expect(container.textContent).toContain(
      GERMAN_COMMON.TransferEvidenceReplaceDiscardsFormat.replace("{0}", "17"),
    )
    // Both glyphs the note reaches for exist. A name matching neither the project art nor the
    // lucide set renders nothing at all rather than failing, so nothing on screen would say so.
    expect(hasIcon("info")).toBe(true)
    expect(hasIcon("common/triangle-alert")).toBe(true)
  })

  it("asks outright before a replace that would destroy what is here", () => {
    mountPanel([packageRow()], "Replace")

    expect(container.textContent).toContain(GERMAN_COMMON.TransferReplaceConfirmTitle)
    expect(container.querySelector("input[type=checkbox]")).not.toBeNull()
  })

  it("does not ask when a replace overlaps nothing", () => {
    const untouched = packageRow({ alreadyHere: 0, newHere: 4, replaceWouldDiscard: 0 })

    mountPanel([untouched], "Replace")

    expect(container.textContent).not.toContain(GERMAN_COMMON.TransferReplaceConfirmTitle)
    expect(container.querySelector("input[type=checkbox]")).toBeNull()
  })

  it("says a package from a newer build cannot be read here, instead of counting what is in it", () => {
    const tooNew = packageRow({ canRead: false })

    mountPanel([tooNew], "KeepBoth")

    expect(container.textContent).toContain(GERMAN_COMMON.TransferEvidenceTooNew)
    expect(container.textContent).not.toContain(
      GERMAN_COMMON.TransferEvidenceDecksFormat.replace("{0}", "4"),
    )
  })
})

function mountPanel(queue: QueuedFile[], conflict: ConflictPolicy): void {
  mount(
    <ImportPanel
      queue={queue}
      formats={FORMATS}
      rejected={[]}
      conflict={conflict}
      busy={false}
      ready
      replaceConfirmed={false}
      onAddFiles={() => {}}
      onRemove={() => {}}
      onConflictChange={() => {}}
      onReplaceConfirmedChange={() => {}}
    />,
  )
}

/** A ready package row whose evidence overlaps this collection, unless the test says otherwise. */
function packageRow(payload: Partial<PayloadEvidenceDto> = {}): QueuedFile {
  return {
    key: "package-1",
    name: "collection.mnemo",
    sizeBytes: 4096,
    status: "ready",
    uploadId: "upload-1",
    formatId: "flashcards.mnemo",
    formatName: "Mnemo Package (.mnemo)",
    cardCount: null,
    evidence: {
      kind: "backup",
      collectionId: "collection-a",
      fromThisCollection: true,
      createdAtUtc: null,
      createdByAppVersion: null,
      canRead: payload.canRead ?? true,
      payloads: [
        {
          payloadType: "flashcards",
          payloadVersion: 3,
          supportedPayloadVersion: 3,
          canRead: true,
          inPackage: 4,
          alreadyHere: 3,
          newHere: 1,
          missingFromPackage: 2,
          replaceWouldDiscard: 17,
          ...payload,
        },
      ],
    },
  }
}
