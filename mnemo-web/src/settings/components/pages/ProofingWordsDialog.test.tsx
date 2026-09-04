// @vitest-environment jsdom

/**
 * What a word's row shows and does.
 *
 * The case worth pinning is a word carried over from the older editor setting.
 * It is stored under a bare code, the host decides which languages a scoped word
 * applies to by primary subtag, and removal matches the stored string exactly.
 * So the row sits on the dictionary that answers for it without offering that
 * code as a second option reading the same name, and a removal carries the
 * stored string rather than the option the row was showing.
 *
 * The order of the two calls a scope change makes is pinned as hard as their
 * arguments. There is no way to move a word, so the add at the new scope comes
 * first and a failure in between leaves the word under both scopes rather than
 * under neither.
 *
 * A write reconciles the list from the host's reply and never refetches the
 * status the editor reads. Mounted under StrictMode, which is how the app runs.
 */

import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useI18nStore } from "@/i18n/store"
import { PROOFING_PERSONAL_KEY } from "@/notes/proofing/status"
import type { PersonalWord, ProofingLanguage } from "@/notes/proofing/types"

import { ProofingWordsDialog } from "./ProofingWordsDialog"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Radix measures and scrolls its menu and captures the pointer, none of which the
// pinned jsdom implements. Scoped to this file.
Element.prototype.scrollIntoView = () => {}
Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => {}
Element.prototype.releasePointerCapture = () => {}

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
    state: "ready",
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

const BUNDLE = {
  Common: { Close: "Close", Error: "Something went wrong", Undo: "Undo", Retry: "Try again" },
  Settings: {
    ProofingPersonalTitle: "Your dictionary",
    ProofingPersonalSubtitle: "Words the checker accepts.",
    ProofingPersonalPlaceholder: "Add a word",
    ProofingPersonalAdd: "Add",
    ProofingPersonalEmpty: "No words yet.",
    ProofingPersonalSearch: "Find a word",
    ProofingPersonalNoMatchFormat: "No word matches {0}.",
    ProofingPersonalRemoveFormat: "Remove {0}",
    ProofingPersonalAlreadyAdded: "That word is already in your dictionary.",
    ProofingScopeAll: "All languages",
    ProofingScopeAppliesTo: "Applies to",
    ProofingScopeLabelFormat: "Languages {0} applies to",
    ProofingPersonalAddedFormat: "Added {0}.",
    ProofingPersonalRemovedFormat: "Removed {0}.",
    ProofingPersonalLoading: "Loading your words.",
    ProofingPersonalFailed: "Your words could not be loaded.",
  },
}

// A fake client standing in for the host: it keeps the word list, so a write
// reconciles from a reply that reflects the change, exactly as the real one does.
const mocks = vi.hoisted(() => {
  const calls: string[] = []
  const failing = { add: false }
  const scopeName = (language: string | null | undefined) => language ?? "(none)"
  const same = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? "").toLowerCase() === (b ?? "").toLowerCase()
  let state: PersonalWord[] = []
  const list = () => ({ words: state.map((entry) => ({ ...entry })) })
  return {
    calls,
    failing,
    setWords(words: PersonalWord[]) {
      state = words.map((entry) => ({ ...entry }))
    },
    list,
    toastInfo: vi.fn(),
    toastWarning: vi.fn(),
    personal: vi.fn(() => Promise.resolve(list())),
    addPersonalWord: vi.fn((word: string, language?: string | null) => {
      calls.push(`add ${word} ${scopeName(language)}`)
      if (failing.add) return Promise.reject(new Error("the host said no"))
      const known = state.some((entry) => same(entry.word, word) && same(entry.language, language))
      if (!known) state.push({ word, language: language ?? null, addedAt: "2026-02-02" })
      return Promise.resolve({ ...list(), outcome: known ? ("alreadyPresent" as const) : ("added" as const) })
    }),
    removePersonalWord: vi.fn((word: string, language?: string | null) => {
      calls.push(`remove ${word} ${scopeName(language)}`)
      state = state.filter((entry) => !(same(entry.word, word) && same(entry.language, language)))
      return Promise.resolve(list())
    }),
  }
})

// The real status hooks and dialog run; only the transport under the client is a
// fake, so the reconcile-from-reply the hooks do is exercised end to end.
vi.mock("@/notes/proofing/client", () => ({
  createProofingClient: () => ({
    personal: mocks.personal,
    addPersonalWord: mocks.addPersonalWord,
    removePersonalWord: mocks.removePersonalWord,
  }),
}))

vi.mock("@/stores/toast", () => ({
  toast: { info: mocks.toastInfo, warning: mocks.toastWarning },
}))

function word(text: string, language: string | null): PersonalWord {
  return { word: text, language, addedAt: "2026-01-01" }
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  useI18nStore.setState({ bundle: BUNDLE, ready: true })
  mocks.setWords([])
  mocks.calls.length = 0
  mocks.failing.add = false
  mocks.toastInfo.mockClear()
  mocks.toastWarning.mockClear()
  mocks.personal.mockClear()
  mocks.addPersonalWord.mockClear()
  mocks.removePersonalWord.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Seeds the cache from the fake's current words, so no fetch is needed to render. */
function render(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(PROOFING_PERSONAL_KEY, mocks.list())
  act(() => {
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ProofingWordsDialog onClose={() => {}} languages={CATALOG} />
        </QueryClientProvider>
      </StrictMode>,
    )
  })
  return client
}

/** Lets the awaited mutation chain (add, then remove) and its render settle. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** One word's overflow trigger, found by the accessible name it carries. */
function scopeMenu(text: string): HTMLElement {
  const trigger = document.body.querySelector<HTMLElement>(`[aria-label="Languages ${text} applies to"]`)
  if (!trigger) throw new Error(`no scope menu for ${text}`)
  return trigger
}

/** The muted label a row carries, which a word for every language does not have one of. */
function scopeLabel(text: string): string {
  const row = scopeMenu(text).closest("div")
  return row?.querySelector("span")?.textContent?.trim() ?? ""
}

/** Opens a word's scope menu and returns the choices it offers, in order. */
function optionsFor(text: string): HTMLElement[] {
  act(() => {
    scopeMenu(text).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  })
  return [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
}

/** The choice a word's menu shows as its current one. */
function chosen(text: string): string | undefined {
  return optionsFor(text)
    .find((node) => node.getAttribute("data-state") === "checked")
    ?.textContent?.trim()
}

function labelsOf(options: HTMLElement[]): (string | undefined)[] {
  return options.map((node) => node.textContent?.trim())
}

/**
 * Picks a scope the way a keyboard does, which needs no pointer capture to work
 * in jsdom, then lets the two writes settle.
 */
async function choose(text: string, label: string) {
  const option = optionsFor(text).find((node) => node.textContent?.trim() === label)
  if (!option) throw new Error(`no option ${label}`)
  await act(async () => {
    option.focus()
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  })
  await flush()
}

/** Closes whatever menu a choice left open, so the next row is reachable. */
function closeMenus() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  })
}

/** The words as the list renders them, in order. */
function renderedWords(): (string | undefined)[] {
  return [...document.body.querySelectorAll<HTMLElement>('[aria-label^="Languages "]')].map((trigger) =>
    trigger.closest("div")?.querySelector("p")?.textContent?.trim(),
  )
}

function type(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Add a word"]')
  if (!input) throw new Error("no add field")
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function clickAdd() {
  const button = [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Add")
  if (!button) throw new Error("no add button")
  act(() => button.click())
}

describe("a word seeded from the older editor setting", () => {
  beforeEach(() => {
    mocks.setWords([word("sillage", "en")])
  })

  // Offering the bare code as well would list English twice.
  it("sits on the dictionary that answers for its bare code", () => {
    render()
    expect(scopeLabel("sillage")).toBe("English")
    expect(chosen("sillage")).toBe("English")
  })

  it("is offered every language on the machine and nothing else", () => {
    render()
    expect(labelsOf(optionsFor("sillage"))).toEqual(["All languages", "English", "Spanish"])
  })

  // Picking a different one afterwards proves the picking works, so the silence
  // above is the guard rather than a test that never pressed anything.
  it("does nothing when set to the language its row already shows", async () => {
    render()
    await choose("sillage", "English")
    expect(mocks.calls).toEqual([])
    closeMenus()

    await choose("sillage", "Spanish")
    expect(mocks.calls).toHaveLength(2)
  })

  // The host has no way to move a word, and it matches a removal against the
  // stored string rather than against the option the row was showing.
  it("is added at the new scope before it is removed at the code it is stored under", async () => {
    render()
    await choose("sillage", "Spanish")
    expect(mocks.calls).toEqual(["add sillage es-ES", "remove sillage en"])
  })

  // Removing first and failing on the add would have dropped the word entirely.
  it("is left where it is when the add fails, rather than lost", async () => {
    mocks.failing.add = true
    render()
    await choose("sillage", "Spanish")
    expect(mocks.calls).toEqual(["add sillage es-ES"])
    expect(mocks.removePersonalWord).not.toHaveBeenCalled()
  })
})

describe("a word with no scope", () => {
  beforeEach(() => {
    mocks.setWords([word("mnemo", null)])
  })

  // No label on the row: every word applies to every language unless it says
  // otherwise, and printing that on every row is a column of the same word.
  it("sits on every language, and says nothing about it", () => {
    render()
    expect(scopeLabel("mnemo")).toBe("")
    expect(chosen("mnemo")).toBe("All languages")
  })

  it("is given a scope by an add at the new one and a removal at no scope", async () => {
    render()
    await choose("mnemo", "English")
    expect(mocks.calls).toEqual(["add mnemo en-US", "remove mnemo (none)"])
  })
})

describe("a word scoped to a language this machine does not have", () => {
  beforeEach(() => {
    mocks.setWords([word("strasse", "de-DE")])
  })

  // Without the extra option the select is handed a value none of its options
  // carry, and the row shows nothing at all.
  it("keeps its own scope as an option of its own", () => {
    render()
    expect(labelsOf(optionsFor("strasse"))).toEqual(["All languages", "English", "Spanish", "German"])
  })

  it("sits on that scope rather than on nothing", () => {
    render()
    expect(scopeLabel("strasse")).toBe("German")
    expect(chosen("strasse")).toBe("German")
  })
})

describe("adding a word", () => {
  it("reconciles the list from the reply without refetching", async () => {
    render()
    type("cafe")
    clickAdd()
    await flush()

    expect(mocks.addPersonalWord).toHaveBeenCalledWith("cafe", undefined)
    expect(renderedWords()).toContain("cafe")
    // The reply carried the new list, so nothing had to be fetched back.
    expect(mocks.personal).not.toHaveBeenCalled()
  })

  it("says so when the word is already there", async () => {
    mocks.setWords([word("cafe", null)])
    render()
    type("cafe")
    clickAdd()
    await flush()

    expect(mocks.toastInfo).toHaveBeenCalledWith("That word is already in your dictionary.")
  })

  it("offers the way back after adding one", async () => {
    render()
    type("cafe")
    clickAdd()
    await flush()

    const [title, options] = mocks.toastInfo.mock.calls[0] as [string, { primary: { onClick: () => void } }]
    expect(title).toBe("Added cafe.")
    await act(async () => options.primary.onClick())
    await flush()
    expect(mocks.removePersonalWord).toHaveBeenCalledWith("cafe", null)
  })

  it("puts the word back when the add fails", async () => {
    mocks.failing.add = true
    render()
    type("cafe")
    clickAdd()
    await flush()

    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Add a word"]')
    expect(input?.value).toBe("cafe")
    expect(mocks.toastWarning).toHaveBeenCalled()
  })
})

describe("the list", () => {
  it("is shown from A to Z", () => {
    mocks.setWords([word("cherry", null), word("apple", null), word("banana", null)])
    render()
    expect(renderedWords()).toEqual(["apple", "banana", "cherry"])
  })

  it("removes a word at the scope it is stored under", async () => {
    mocks.setWords([word("sillage", "en")])
    render()
    const remove = document.body.querySelector<HTMLElement>('[aria-label="Remove sillage"]')
    act(() => remove?.click())
    await flush()

    expect(mocks.removePersonalWord).toHaveBeenCalledWith("sillage", "en")
    expect(renderedWords()).toEqual([])
  })

  // The two rows share one mutation, and a mutation's observer follows only its
  // latest call, so a receipt handed to the call itself would be lost the moment
  // the second row was clicked.
  it("offers the way back from every removal, even two in quick succession", async () => {
    mocks.setWords([word("apple", null), word("banana", null)])
    render()
    act(() => {
      document.body.querySelector<HTMLElement>('[aria-label="Remove apple"]')?.click()
      document.body.querySelector<HTMLElement>('[aria-label="Remove banana"]')?.click()
    })
    await flush()

    expect(renderedWords()).toEqual([])
    expect(mocks.toastInfo.mock.calls.map((call) => call[0])).toEqual(["Removed apple.", "Removed banana."])

    const [, options] = mocks.toastInfo.mock.calls[0] as [string, { primary: { onClick: () => void } }]
    await act(async () => options.primary.onClick())
    await flush()
    expect(mocks.addPersonalWord).toHaveBeenLastCalledWith("apple", null)
    expect(renderedWords()).toEqual(["apple"])
  })

  // The add field is the body's first control and the search is up in the header;
  // two text fields in one corner read as one control that cannot decide its job.
  it("offers the search only once the list is long enough to need it", () => {
    mocks.setWords([word("a", null), word("b", null)])
    render()
    expect(document.body.querySelector('input[aria-label="Find a word"]')).toBeNull()

    act(() => root.unmount())
    root = createRoot(container)
    mocks.setWords(["a", "b", "c", "d", "e", "f", "g"].map((text) => word(text, null)))
    render()
    const search = document.body.querySelector('input[aria-label="Find a word"]')
    expect(search).not.toBeNull()
    expect(search?.closest("header")).not.toBeNull()
  })
})
