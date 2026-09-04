// @vitest-environment jsdom

/**
 * What the page says about the languages a note is checked in.
 *
 * The list is the active set and nothing else, so an entry has no off state and
 * the only membership control is the row menu's Remove. Order is what decides
 * whose corrections are offered first, which is why exactly one row carries the
 * tag that says so.
 *
 * Mounted under StrictMode, which is how the app runs.
 */

import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useI18nStore } from "@/i18n/store"
import type { PersonalWord, ProofingLanguage, ProofingStatus } from "@/notes/proofing/types"

import { ProofingPage } from "./ProofingPage"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CATALOG: ProofingLanguage[] = [
  {
    id: "en-US",
    name: "English",
    region: "United States",
    installed: true,
    bundled: true,
    state: "ready",
    license: { name: "SCOWL", url: "https://example.com" },
  },
  {
    id: "es-ES",
    name: "Spanish",
    region: "Spain",
    installed: true,
    bundled: true,
    state: "loading",
    license: { name: "GPLv3", url: "https://example.com" },
  },
  {
    id: "de-DE",
    name: "German",
    region: "Germany",
    installed: false,
    bundled: false,
    state: "absent",
    reasonKey: "proofing.language.notAvailableYet",
    license: { name: "GPLv2", url: "https://example.com" },
  },
]

/**
 * The English strings these assertions read. Spelled out rather than loaded from
 * the shipped bundle, which reaches the repository through `import.meta.url` and
 * so cannot be read from a jsdom file. That the keys exist at all is the i18n
 * test's job; this one is about which of them the page reaches for.
 */
const BUNDLE = {
  Settings: {
    ProofingCategoryTitle: "Spelling",
    ProofingLanguagesTitle: "Languages you write in",
    ProofingStateReady: "Ready",
    ProofingStateLoading: "Preparing",
    ProofingSuggestsFirst: "Suggests first",
    ProofingLanguageOptionsFormat: "Options for {0}",
    ProofingAddLanguage: "Add a language",
    ProofingNoLanguages: "No language is switched on",
    ProofingNoLanguagesDescription: "Nothing is checked until you add one.",
    ProofingPickerInstalled: "Available",
    ProofingPickerUnavailable: "Not available",
    ProofingPickerAdd: "Add",
    ProofingPickerAddFormat: "Add {0}",
    ProofingPickerAdded: "Added",
    ProofingPersonalAddedWords: "Added words",
    ProofingPersonalNone: "Nothing yet.",
    ProofingPersonalCountOne: "{0} word",
    ProofingPersonalCountMany: "{0} words",
    ProofingPersonalManage: "Manage",
    "proofing.language.notAvailableYet": "No dictionary ships for this language yet.",
  },
}

const mocks = vi.hoisted(() => ({
  status: undefined as unknown,
  words: [] as unknown[],
}))

// The status is the host's answer, not a setting the page can compute, so it is
// handed in rather than fetched. Everything else in the module stays real,
// including the invalidation, which is why the tree still needs a query client.
vi.mock("@/notes/proofing/status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/notes/proofing/status")>()),
  useProofingStatus: () => ({ data: mocks.status }),
  useProofingPersonalWords: () => ({ data: { words: mocks.words } }),
}))

function status(active: string[]): ProofingStatus {
  return { enabled: true, active, languages: CATALOG, personalWordCount: mocks.words.length }
}

function word(text: string, language: string | null = null): PersonalWord {
  return { word: text, language, addedAt: "2026-01-01" }
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  useI18nStore.setState({ bundle: BUNDLE, ready: true })
  mocks.status = status([])
  mocks.words = []
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => {
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ProofingPage />
        </QueryClientProvider>
      </StrictMode>,
    )
  })
}

function textOf(node: ParentNode): string {
  return node.textContent ?? ""
}

function buttonSaying(scope: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll("button")].find((button) => button.textContent?.trim() === label)
}

describe("the spelling page with nothing switched on", () => {
  it("says nothing is being checked and offers the picker", () => {
    render()
    expect(textOf(container)).toContain("No language is switched on")
    expect(textOf(container)).toContain("Nothing is checked until you add one.")
    expect(buttonSaying(container, "Add a language")).toBeDefined()
  })

  it("shows no language row, so there is nothing to reorder", () => {
    render()
    expect(container.querySelectorAll('[aria-label^="Options for"]')).toHaveLength(0)
  })

  it("reports an empty word list beside a way to manage it", () => {
    render()
    expect(textOf(container)).toContain("Nothing yet.")
    expect(textOf(container)).toContain("0 words")
    expect(buttonSaying(container, "Manage")).toBeDefined()
  })

  it("offers every installed dictionary in the picker, named for a screen reader", () => {
    render()
    act(() => buttonSaying(container, "Add a language")?.click())

    const dialog = document.body.querySelector('[role="dialog"]')
    const adds = [...dialog!.querySelectorAll('[aria-label^="Add "]')].map((node) => node.getAttribute("aria-label"))
    expect(adds).toEqual(["Add English", "Add Spanish"])
  })
})

describe("the spelling page with two languages on", () => {
  beforeEach(() => {
    mocks.words = [word("mnemo"), word("sillage", "en")]
    mocks.status = status(["en-US", "es-ES"])
  })

  it("lists the active set in order, with a menu on each row", () => {
    render()
    const menus = [...container.querySelectorAll('[aria-label^="Options for"]')].map((node) =>
      node.getAttribute("aria-label"),
    )
    expect(menus).toEqual(["Options for English", "Options for Spanish"])
  })

  it("tags only the first row as the one that suggests first", () => {
    render()
    const tags = [...container.querySelectorAll("span")].filter((node) => node.textContent === "Suggests first")
    expect(tags).toHaveLength(1)
    expect(textOf(tags[0].closest("div") ?? container)).toContain("English")
  })

  it("puts each language's own state under its name", () => {
    render()
    expect(textOf(container)).toContain("Ready")
    expect(textOf(container)).toContain("Preparing")
  })

  it("previews the added words beside their count and a manage button", () => {
    render()
    expect(textOf(container)).toContain("mnemo, sillage")
    expect(textOf(container)).toContain("2 words")
    expect(buttonSaying(container, "Manage")).toBeDefined()
  })

  it("opens the picker on demand and not before", () => {
    render()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    act(() => buttonSaying(container, "Add a language")?.click())

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    // Both groups, split on whether the language can be checked at all, and the
    // second states the host's reason rather than offering a button for a
    // download that does not exist.
    const headings = [...dialog!.querySelectorAll("section > p")].map((node) => node.textContent)
    expect(headings).toEqual(["Available", "Not available"])
    expect(textOf(dialog!)).toContain("No dictionary ships for this language yet.")
    expect(buttonSaying(dialog!, "Add")).toBeUndefined()
    expect(textOf(dialog!)).toContain("Added")
  })
})
