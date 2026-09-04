// @vitest-environment jsdom

/**
 * The two things that make a note in the peek safe.
 *
 * **It cannot write.** The panel builds its own editor services, and the bag the mount
 * receives is asserted here rather than the absence of an authority alone: the writable
 * pane's bag carries `uploadAsset`, which puts bytes on disk, and a note library with
 * `createChild`, which creates a note. Handing that over because it happens to contain
 * the two reads is exactly how a read-only surface ends up holding two write seams.
 *
 * **It does not follow the note, and it does not disturb it.** Autosave patches the note
 * cache on every commit instead of invalidating it, so the entry the writable pane reads
 * is the truth rather than a copy of the server. The peek therefore reads under a key of
 * its own and never rebuilds from a cache change: a second observer on the pane's key
 * would refetch on mount and roll that entry backwards, and rebuilding on every patch
 * would tear down a whole EditorView every few seconds on a document that can be
 * thousands of blocks.
 *
 * Everything mounts under StrictMode, which is how the app runs.
 */

import { StrictMode, act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { NoteDto } from "@/api/types"
import type { EditorServices } from "@/notes/editor/registry/types"
import { block, span } from "@/notes/editor/mapper/fixtures"
import { serializeBlocks } from "@/notes/model/wire"

import { NotePeek } from "./renderers/NotePeek"
import { usePeekStore } from "./store"

const mocks = vi.hoisted(() => ({
  mounts: [] as Partial<EditorServices>[],
  editableFlags: [] as (boolean | undefined)[],
  destroys: 0,
  builds: 0,
  texts: [] as string[],
  createNoteAuthority: vi.fn(),
  onDirtyCheck: vi.fn(() => () => {}),
  onShutdown: vi.fn(() => () => {}),
  openNoteAssetSession: vi.fn(),
}))

// The real mount builds NodeViews and a live EditorView, which is not what is under test
// here: what is under test is what it is handed, and how many times.
vi.mock("@/notes/editor/view/mount", () => ({
  mountEditor: (options: {
    services?: Partial<EditorServices>
    editable?: boolean
    state: { doc: { textContent: string } }
  }) => {
    mocks.mounts.push(options.services ?? {})
    mocks.editableFlags.push(options.editable)
    mocks.texts.push(options.state.doc.textContent)
    return {
      handle: { state: null, destroy: () => {} },
      destroy: () => {
        mocks.destroys += 1
      },
    }
  },
  DEFAULT_CHUNK_THRESHOLD: 2000,
}))

// Loaded for the spies alone. Nothing on this path should reach any of them.
vi.mock("@/notes/authority/authority", () => ({ createNoteAuthority: mocks.createNoteAuthority }))
vi.mock("@/app/shutdown", () => ({
  onDirtyCheck: mocks.onDirtyCheck,
  onShutdown: mocks.onShutdown,
  onShutdownGuard: vi.fn(() => () => {}),
}))
vi.mock("@/notes/assets/session", () => ({ openNoteAssetSession: mocks.openNoteAssetSession }))
vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))

// Counted, not replaced. Parsing the blocks and building the state is the expensive half
// of following a cache that changes every few seconds, and it happens whether or not the
// mount decides to use what it produced.
vi.mock("@/notes/read/build-state", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/notes/read/build-state")>()
  return {
    ...real,
    buildNoteReadState: (blocks: Parameters<typeof real.buildNoteReadState>[0]) => {
      mocks.builds += 1
      return real.buildNoteReadState(blocks)
    },
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOTE_ID = "n1"
/** What the writable pane reads, and what autosave patches. The peek must not touch it. */
const editorKey = ["notes", "note", NOTE_ID]
const peekKey = (refresh = 0) => ["peek", "note", NOTE_ID, refresh]

function note(ver: number, text: string): NoteDto {
  return {
    id: NOTE_ID,
    sid: "abc123",
    ver,
    title: "Cranial nerves",
    content: "",
    blocks: serializeBlocks([block("Text", [span(text)])]),
    folderId: null,
    parentNoteId: null,
    order: 0,
    isFavorite: false,
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
    emoji: null,
    cover: null,
    coverCrop: null,
    tags: [],
  } as unknown as NoteDto
}

let container: HTMLElement
let root: Root
let client: QueryClient
/** What a `GET /api/notes/{id}` answers with, and how many times it was asked. */
let served: NoteDto
let fetches: string[]

function withClient(node: ReactNode): ReactNode {
  return (
    <StrictMode>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </StrictMode>
  )
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

beforeEach(() => {
  mocks.mounts = []
  mocks.editableFlags = []
  mocks.destroys = 0
  mocks.builds = 0
  mocks.texts = []
  vi.clearAllMocks()

  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  usePeekStore.setState({ item: { kind: "note", id: NOTE_ID } })

  served = note(1, "hello")
  fetches = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    fetches.push(String(input instanceof Request ? input.url : input))
    return new Response(JSON.stringify(served), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  client.clear()
})

describe("a note in the peek is read only", () => {
  it("hands the mount a bag with no upload and no note library", async () => {
    client.setQueryData(peekKey(), note(1, "hello"))
    act(() => root.render(withClient(<NotePeek noteId={NOTE_ID} refresh={0} />)))
    await settle()

    expect(mocks.mounts.length).toBeGreaterThan(0)
    for (const services of mocks.mounts) {
      expect(services.loadAssetUrl).toBeTypeOf("function")
      expect(services.resolveNoteTitle).toBeTypeOf("function")
      expect(services.uploadAsset).toBeUndefined()
      expect(services.notes).toBeUndefined()
    }
  })

  it("mounts the view as not editable", async () => {
    client.setQueryData(peekKey(), note(1, "hello"))
    act(() => root.render(withClient(<NotePeek noteId={NOTE_ID} refresh={0} />)))
    await settle()

    expect(mocks.editableFlags.every((flag) => flag === false)).toBe(true)
  })

  it("creates no authority, no autosave participant and no asset session", async () => {
    client.setQueryData(peekKey(), note(1, "hello"))
    act(() => root.render(withClient(<NotePeek noteId={NOTE_ID} refresh={0} />)))
    await settle()

    expect(mocks.createNoteAuthority).not.toHaveBeenCalled()
    expect(mocks.onDirtyCheck).not.toHaveBeenCalled()
    expect(mocks.onShutdown).not.toHaveBeenCalled()
    expect(mocks.openNoteAssetSession).not.toHaveBeenCalled()
  })
})

describe("a note in the peek is a snapshot", () => {
  it("builds no further view as autosave patches the cache underneath it", async () => {
    client.setQueryData(peekKey(), note(1, "hello"))
    act(() => root.render(withClient(<NotePeek noteId={NOTE_ID} refresh={0} />)))
    await settle()

    const afterMount = mocks.mounts.length
    const builtAtMount = mocks.builds
    expect(afterMount).toBeGreaterThan(0)
    // One live view: StrictMode's deliberate double invoke mounts and destroys one more.
    expect(afterMount - mocks.destroys).toBe(1)

    for (let commit = 2; commit <= 8; commit += 1) {
      await act(async () => {
        client.setQueryData(peekKey(), note(commit, `hello ${String(commit)}`))
      })
    }
    await settle()

    expect(mocks.mounts.length).toBe(afterMount)
    expect(mocks.mounts.length - mocks.destroys).toBe(1)
    expect(mocks.builds).toBe(builtAtMount)
  })

  /*
   * The entry the writable pane reads is not a cache of the server, it is the truth:
   * autosave patches it with the blocks it just sent rather than invalidating it, so that
   * reopening the note builds from what was typed. A second observer on that key would
   * refetch on mount and write the server's older answer over the patch, and the next
   * commit would then be a stale write the authority holds as a conflict until the note
   * is reloaded.
   */
  it("leaves the entry the writable pane reads exactly as it found it", async () => {
    const typed = note(9, "everything typed since the last commit")
    client.setQueryData(editorKey, typed)
    // What the server still holds mid debounce.
    served = note(4, "what the server had")

    act(() => root.render(withClient(<NotePeek noteId={NOTE_ID} refresh={0} />)))
    await settle()

    expect(client.getQueryData(editorKey)).toBe(typed)
    expect(client.getQueryState(editorKey)?.fetchStatus).toBe("idle")
    expect(fetches.filter((url) => url.includes(`/notes/${NOTE_ID}`))).toHaveLength(1)
    expect(client.getQueryData<NoteDto>(peekKey())?.ver).toBe(4)
  })
})

describe("an item that stops existing", () => {
  it("closes the peek when the note 404s", async () => {
    client.setQueryData(peekKey(), undefined)
    globalThis.fetch = vi.fn(
      async () => new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } }),
    )

    act(() => root.render(withClient(<NotePeek noteId={NOTE_ID} refresh={0} />)))
    await settle()

    expect(usePeekStore.getState().item).toBeNull()
  })
})

describe("refreshing", () => {
  /*
   * A remount is not a read. The entry is never stale and the remount does not ask, and a
   * React key change unmounts and remounts inside one synchronous commit, so an eviction
   * scheduled on a timer has no gap to run in. The refresh counter is in the query key for
   * that reason: it names an entry nothing has fetched yet.
   *
   * The panel drives this by remounting the body under a new key, which is what the second
   * render here reproduces.
   */
  it("re-reads the server and shows the newer note", async () => {
    served = note(1, "as it was")
    act(() => root.render(withClient(<NotePeek key="0" noteId={NOTE_ID} refresh={0} />)))
    await settle()

    const reads = () => fetches.filter((url) => url.includes(`/notes/${NOTE_ID}`)).length
    expect(reads()).toBe(1)
    expect(mocks.texts.at(-1)).toContain("as it was")

    served = note(2, "as it is now")
    act(() => root.render(withClient(<NotePeek key="1" noteId={NOTE_ID} refresh={1} />)))
    await settle()

    expect(reads()).toBe(2)
    expect(client.getQueryData<NoteDto>(peekKey(1))?.ver).toBe(2)
    expect(mocks.texts.at(-1)).toContain("as it is now")
  })

  it("still leaves the entry the writable pane reads alone", async () => {
    const typed = note(9, "everything typed since the last commit")
    client.setQueryData(editorKey, typed)
    served = note(1, "as it was")

    act(() => root.render(withClient(<NotePeek key="0" noteId={NOTE_ID} refresh={0} />)))
    await settle()
    served = note(2, "as it is now")
    act(() => root.render(withClient(<NotePeek key="1" noteId={NOTE_ID} refresh={1} />)))
    await settle()

    expect(client.getQueryData(editorKey)).toBe(typed)
    expect(client.getQueryState(editorKey)?.fetchStatus).toBe("idle")
  })
})
