// @vitest-environment jsdom

/**
 * A rejected file's row used to show the server's raw English warning string verbatim. Now the
 * server sends a translation key and its values, and the row resolves them through the real
 * `useT`/`useI18nStore`. This mounts the panel against a Norwegian Bokmal bundle read straight
 * from Mnemo.Infrastructure/Languages/nb.json, the same file the Host serves to the browser, so a
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
import { MindmapImportPanel } from "./MindmapImportPanel"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Read with plain node:fs rather than the import.meta.url trick i18n/test-bundle.ts uses: that
// trick resolves to a non-file URL once this file runs under the jsdom environment, which this
// suite needs for `document`. process.cwd() is mnemo-web for every documented way this suite runs.
const LANGUAGES_DIR = path.resolve(process.cwd(), "..", "Mnemo.Infrastructure", "Languages")
const NORWEGIAN = JSON.parse(readFileSync(path.join(LANGUAGES_DIR, "nb.json"), "utf8")) as {
  Common: Record<string, string>
  TransferWarnings: Record<string, string>
}
const NORWEGIAN_TRANSFER_WARNINGS = NORWEGIAN.TransferWarnings

const READY_FILE: QueuedFile = {
  key: "row-ready",
  name: "Study.mnemo",
  sizeBytes: 2048,
  status: "ready",
  uploadId: "u1",
  mapCount: 1,
}

const FORMATS: TransferFormatDto[] = [
  {
    formatId: "mindmaps.mnemo",
    displayName: "Mnemo Package (.mnemo)",
    extensions: [".mnemo"],
    supportsImport: true,
    supportsExport: true,
  },
]

let container: HTMLElement
let root: Root

beforeEach(() => {
  useI18nStore.setState({ bundle: { TransferWarnings: NORWEGIAN_TRANSFER_WARNINGS } })
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

describe("the mindmap import panel", () => {
  it("resolves a rejected file's server warning through the active Norwegian bundle", () => {
    const queue: QueuedFile[] = [
      {
        key: "row-1",
        name: "map.mnemo",
        sizeBytes: 1024,
        status: "rejected",
        formatName: "Mnemo Package (.mnemo)",
        notes: [{ key: "MindmapDeserializeFailed", params: {} }],
      },
    ]

    mount(
      <MindmapImportPanel
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

    const expected = NORWEGIAN_TRANSFER_WARNINGS.MindmapDeserializeFailed
    expect(expected).toBe("Hoppet over et tankekart som ikke kunne leses.")
    expect(container.textContent).toContain(expected)
    expect(container.textContent).not.toContain("MindmapDeserializeFailed")
  })

  it("asks outright before a replace, which for a map really cannot be undone", () => {
    useI18nStore.setState({ bundle: { Common: NORWEGIAN.Common } })

    mount(
      <MindmapImportPanel
        queue={[READY_FILE]}
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
    expect(container.textContent).toContain("Å erstatte kan ikke angres")
    expect(container.textContent).not.toContain("TransferReplaceConfirmTitle")
  })

  it("does not ask under a policy that takes nothing", () => {
    useI18nStore.setState({ bundle: { Common: NORWEGIAN.Common } })

    mount(
      <MindmapImportPanel
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
