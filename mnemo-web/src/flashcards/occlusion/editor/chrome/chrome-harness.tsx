import { readFileSync } from "node:fs"
import path from "node:path"

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { Dialog } from "radix-ui"
import { vi } from "vitest"

import type { CardTypeDto } from "@/api/types"
import { useI18nStore } from "@/i18n/store"
import { useKeybindStore } from "@/keybinds/store"
import type { Keybind } from "@/keybinds/types"

import type { DraftAttachment } from "../../../editor/draft"
import { emptyDraft, type CardLoss, type FactDraft } from "../../../facts/fact-draft"
import { serializeOcclusion, type OcclusionDocument } from "../../../facts/occlusion"
import { loadImages } from "../../image-test-helpers"
import { DEFAULT_CHORDS } from "../keys"
import { trio } from "../test-kit"
import { OcclusionLayout, type OcclusionLayoutProps } from "./OcclusionLayout"

export const occlusionType: CardTypeDto = {
  id: "occlusion",
  name: "Image occlusion",
  isBuiltIn: true,
  fields: [
    { id: "image", name: "Image", hint: null },
    { id: "front", name: "Front", hint: "The question" },
    { id: "back", name: "Back", hint: "Shown with every answer" },
    { id: "masks", name: "Masks", hint: null },
  ],
  sortFieldId: "front",
  layouts: [],
  generator: "occlusion",
  generateFrom: "image",
  createdAt: "2026-01-01T00:00:00+00:00",
  updatedAt: "2026-01-01T00:00:00+00:00",
}

export function picture(assetId = "asset1"): DraftAttachment {
  return { key: assetId, id: null, assetId, side: "front", displayName: "plant.png", sizeBytes: 10, caption: null }
}

/** A draft holding an image and the given masks. */
export function draftWith(document: OcclusionDocument | null = trio(), image = true): FactDraft {
  return {
    ...emptyDraft("d1", "occlusion"),
    values: document ? { masks: serializeOcclusion(document) } : {},
    media: image ? { image: [picture()] } : {},
  }
}

/** The editor's chords as the keybind catalog serves them, so keys reach the editor in tests. */
export function seedKeybinds(): void {
  const keybinds: Keybind[] = Object.entries(DEFAULT_CHORDS).map(([action, chords]) => ({
    actionId: `flashcards-occlusion.${action}`,
    namespace: "flashcards-occlusion",
    scope: "Local",
    enabled: true,
    allowedDuringTextCapture: false,
    toggleOnRepeat: false,
    bindings: chords.map((chord) => ({ kind: "Chord", chord })),
    isOverridden: false,
  }))
  useKeybindStore.getState().setKeybinds(keybinds)
}

const REPO = path.resolve(import.meta.dirname, "../../../../../..")

/** English as the app serves it: the shared strings plus the two modules this chrome reads. */
function englishBundle(): Record<string, Record<string, string>> {
  const merged: Record<string, Record<string, string>> = {}
  const files = ["Languages", "Modules/Flashcards/Translations", "Modules/Mindmap/Translations"]
  for (const folder of files) {
    const data = JSON.parse(readFileSync(path.join(REPO, "Mnemo.Infrastructure", folder, "en.json"), "utf8")) as typeof merged
    for (const [ns, entries] of Object.entries(data)) Object.assign((merged[ns] ??= {}), entries)
  }
  return merged
}

export function useEnglish(): void {
  useI18nStore.setState({ bundle: englishBundle(), language: "en", ready: true })
}

/** jsdom runs no layout, so the size every element reports is whatever a test says the window is. */
export function setViewport(w: number, h: number): void {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => w })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => h })
}

export function clearViewport(): void {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth")
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight")
}

export interface Spies {
  onSave: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  onImage: ReturnType<typeof vi.fn>
  onOpenChange: ReturnType<typeof vi.fn>
  /** The draft as the layout last wrote it back. */
  draft: () => FactDraft
}

export interface MountOptions {
  draft?: FactDraft
  loss?: CardLoss
  canSave?: boolean
  isEditMode?: boolean
}

let host: HTMLDivElement
let root: Root

export function mountLayout(options: MountOptions = {}): Spies {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)

  let latest = options.draft ?? draftWith()
  const spies = {
    onSave: vi.fn(),
    onClose: vi.fn(),
    onImage: vi.fn(),
    onOpenChange: vi.fn(),
    draft: () => latest,
  }

  function Harness() {
    const [draft, setDraft] = useState(latest)
    latest = draft
    const props: OcclusionLayoutProps = {
      header: {
        title: "Edit card",
        deckId: "d1",
        deckChoices: [{ value: "d1", label: "Deck 1" }],
        onDeck: () => {},
        typeId: "occlusion",
        typeChoices: [{ value: "occlusion", label: "Image occlusion" }],
        onType: () => {},
      },
      type: occlusionType,
      draft,
      loss: options.loss ?? { removed: [], kept: 0 },
      isEditMode: options.isEditMode ?? true,
      sessionAdded: 0,
      canSave: options.canSave ?? true,
      saving: false,
      onValue: (fieldId, value) => setDraft((current) => ({ ...current, values: { ...current.values, [fieldId]: value } })),
      onTags: (tags) => setDraft((current) => ({ ...current, tags })),
      onImage: spies.onImage,
      onSave: spies.onSave,
      onClose: spies.onClose,
    }
    return (
      <Dialog.Root open onOpenChange={spies.onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <OcclusionLayout {...props} />
        </Dialog.Portal>
      </Dialog.Root>
    )
  }

  act(() => root.render(<Harness />))
  // Radix mounts its content after the first commit.
  act(() => {})
  loadImages(document.body)
  return spies
}

export function unmountLayout(): void {
  act(() => root.unmount())
  host.remove()
}

export const content = () => document.querySelector<HTMLElement>("[data-occlusion-editor]")!
export const rows = () => [...document.querySelectorAll<HTMLElement>("[data-card-row]")]
/** Text with the whitespace between inline SVG icons squeezed out. */
export const text = (element: Element | null | undefined) => (element?.textContent ?? "").replace(/\s*\n\s*/g, "").trim()

export function byLabel(label: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!found) throw new Error(`nothing labelled ${label}`)
  return found
}

export function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent === name,
  )
}

export function click(element: Element, init: MouseEventInit = {}): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }))
  })
}

export function press(key: string, init: KeyboardEventInit = {}, target: Element = content()): KeyboardEvent {
  const named: Record<string, string> = { "[": "BracketLeft", "]": "BracketRight" }
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : (named[key] ?? key)
  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

export function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))
  })
}

export function masksOf(spies: Spies): { id: string; label?: string; group?: string; order: number }[] {
  const value = spies.draft().values.masks
  return (JSON.parse(value) as { masks: { id: string; label?: string; group?: string; order: number }[] }).masks
}
