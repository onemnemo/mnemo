// @vitest-environment jsdom

/**
 * A rejected file's row used to show the server's raw English warning string verbatim. Now the
 * server sends a translation key and its values, and the row resolves them through the real
 * `useT`/`useI18nStore`. This mounts the panel against a Japanese bundle read straight from
 * Mnemo.Infrastructure/Languages/ja.json, the same file the Host serves to the browser, so a
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
import { NoteImportPanel } from "./NoteImportPanel"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Read with plain node:fs rather than the import.meta.url trick i18n/test-bundle.ts uses: that
// trick resolves to a non-file URL once this file runs under the jsdom environment, which this
// suite needs for `document`. process.cwd() is mnemo-web for every documented way this suite runs.
const LANGUAGES_DIR = path.resolve(process.cwd(), "..", "Mnemo.Infrastructure", "Languages")
const JAPANESE_TRANSFER_WARNINGS = (
  JSON.parse(readFileSync(path.join(LANGUAGES_DIR, "ja.json"), "utf8")) as {
    TransferWarnings: Record<string, string>
  }
).TransferWarnings

function notesNamespace(file: string): Record<string, string> {
  return (JSON.parse(readFileSync(file, "utf8")) as { Notes: Record<string, string> }).Notes
}

// Module translations override matching shared keys in the served bundle.
const NOTES_MODULE_ENGLISH = notesNamespace(
  path.resolve(process.cwd(), "..", "Mnemo.Infrastructure", "Modules", "Notes", "Translations", "en.json"),
)
const SERVED_ENGLISH_NOTES = {
  ...notesNamespace(path.join(LANGUAGES_DIR, "en.json")),
  ...NOTES_MODULE_ENGLISH,
}

const READY_FILE: QueuedFile = {
  key: "row-ready",
  name: "Biology.md",
  sizeBytes: 512,
  status: "ready",
  uploadId: "u1",
  noteCount: 1,
}

const FORMATS: TransferFormatDto[] = [
  {
    formatId: "notes.mnemo",
    displayName: "Mnemo Package (.mnemo)",
    extensions: [".mnemo"],
    supportsImport: true,
    supportsExport: true,
  },
]

let container: HTMLElement
let root: Root

beforeEach(() => {
  useI18nStore.setState({ bundle: { TransferWarnings: JAPANESE_TRANSFER_WARNINGS } })
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

describe("the notes import panel", () => {
  it("resolves a rejected file's server warning through the active Japanese bundle", () => {
    const queue: QueuedFile[] = [
      {
        key: "row-1",
        name: "note.mnemo",
        sizeBytes: 4096,
        status: "rejected",
        formatName: "Mnemo Package (.mnemo)",
        notes: [{ key: "NoteImportFailed", params: { noteTitle: "旅行の計画", error: "重複したID" } }],
      },
    ]

    mount(
      <NoteImportPanel
        queue={queue}
        formats={FORMATS}
        rejected={[]}
        conflict="KeepBoth"
        busy={false}
        ready
        replaceConfirmed={false}
        onAddFiles={() => {}}
        onRemove={() => {}}
        onConflictChange={() => {}}
        onReplaceConfirmedChange={() => {}}
      />,
    )

    const expected = JAPANESE_TRANSFER_WARNINGS.NoteImportFailed.replace("{noteTitle}", "旅行の計画").replace(
      "{error}",
      "重複したID",
    )
    expect(expected).toBe("ノート「旅行の計画」のインポートに失敗しました: 重複したID")
    expect(container.textContent).toContain(expected)
    expect(container.textContent).not.toContain("NoteImportFailed")
  })

  it.each([
    ["Markdown", ["Biology.md"]],
    ["package", ["Biology.mnemo"]],
    ["mixed", ["Biology.md", "Chemistry.mnemo"]],
  ])("explains both replacement outcomes for a %s queue", (_format, names) => {
    useI18nStore.setState({ bundle: { Notes: SERVED_ENGLISH_NOTES } })

    mount(
      <NoteImportPanel
        queue={names.map((name) => ({ ...READY_FILE, key: name, name }))}
        formats={FORMATS}
        rejected={[]}
        conflict="Replace"
        busy={false}
        ready
        replaceConfirmed={false}
        onAddFiles={() => {}}
        onRemove={() => {}}
        onConflictChange={() => {}}
        onReplaceConfirmedChange={() => {}}
      />,
    )

    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull()
    const consent = container.querySelector('input[type="checkbox"]')?.closest("label")
    expect(consent?.textContent).toContain("Replace existing notes?")
    expect(consent?.textContent).toContain(
      "Markdown imports keep the old content in the trash for recovery as a separate note.",
    )
    expect(consent?.textContent).toContain("Package imports permanently overwrite it.")
  })

  it("does not ask under a policy that takes nothing", () => {
    useI18nStore.setState({ bundle: { Notes: SERVED_ENGLISH_NOTES } })

    mount(
      <NoteImportPanel
        queue={[READY_FILE]}
        formats={FORMATS}
        rejected={[]}
        conflict="KeepBoth"
        busy={false}
        ready
        replaceConfirmed={false}
        onAddFiles={() => {}}
        onRemove={() => {}}
        onConflictChange={() => {}}
        onReplaceConfirmedChange={() => {}}
      />,
    )

    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
  })
})
