// @vitest-environment jsdom

/**
 * The save seam's contract. Every export in the app funnels through here, so the three outcomes it
 * can report, and the fact that the destination is never something this side names, are the whole
 * of what the callers rely on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import { ApiError } from "./client"
import {
  announceExport,
  exportFileName,
  exportRequest,
  exportSaveOptions,
  saveExport,
  saveServerExport,
} from "./export-file"

vi.mock("@/stores/dialog", () => ({
  dialog: { confirm: vi.fn(async () => true), prompt: vi.fn() },
}))

vi.mock("@/stores/toast", () => ({
  toast: { success: vi.fn(), warning: vi.fn() },
}))

interface Call {
  url: string
  init: RequestInit | undefined
}

let calls: Call[]
let responses: Response[]
/** Every link the browser fallback built, which is the only place a download name shows up. */
let anchors: HTMLAnchorElement[]
// Captured before anything spies on it, or each run wraps the previous run's spy and recurses.
const nativeCreateElement = document.createElement.bind(document)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** The chooser answering with a destination and its grant, then the write reporting what it wrote. */
function hostSaves(path: string, confirmOverwrite = false): void {
  responses = [json({ available: true, path, grant: "abc123", confirmOverwrite }), json({ path })]
}

/**
 * Stands in for the `Common` translate. Keys come back as themselves so assertions can name them,
 * except the overwrite message, which carries the real `{0}` the seam substitutes the path into.
 */
const t = (key: string) => (key === "ExportOverwriteMessage" ? "A file already sits at {0}." : key)

/** A save request with the copy the UI would have supplied. */
const save = { fileName: "deck.mnemo", ...exportSaveOptions(t) }

/** Stands in for a route that produces the file itself, which is every export but the pictures. */
const sendExport = (grant: string | null) =>
  exportRequest("/flashcards/transfer/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formatId: "flashcards.mnemo", grant }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(dialog.confirm).mockResolvedValue(true)
  calls = []
  responses = []
  anchors = []
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const element = nativeCreateElement(tag)
    if (tag === "a") anchors.push(element as HTMLAnchorElement)
    return element
  }) as typeof document.createElement)
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const next = responses.shift()
      if (!next) throw new Error(`No response queued for ${url}`)
      return Promise.resolve(next)
    }),
  )
  // jsdom has no object URL implementation, and the browser fallback reaches for one.
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The multipart body of the write, which is the only place its inputs can be checked. */
function writeForm(): FormData {
  return calls[1].init?.body as FormData
}

describe("saveExport", () => {
  it("reports a dismissed chooser as cancelled and writes nothing", async () => {
    responses = [json({ available: true, path: null, grant: null, confirmOverwrite: false })]

    const outcome = await saveExport(new Blob(["x"]), save)

    expect(outcome).toEqual({ status: "cancelled" })
    // The second request is the write. Its absence is the point: a cancel costs nothing.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("/api/app/export-file/target")
  })

  it("reports the path the host says it wrote", async () => {
    hostSaves("/home/me/Documents/deck.mnemo")

    const outcome = await saveExport(new Blob(["x"]), save)

    expect(outcome).toEqual({ status: "saved", path: "/home/me/Documents/deck.mnemo" })
    expect(calls[1].url).toBe("/api/app/export-file")
  })

  it("sends the grant and never a path, so the page cannot name a destination", async () => {
    hostSaves("/home/me/Backups/deck.mnemo")

    await saveExport(new Blob(["x"]), save)

    const form = writeForm()
    expect(form).toBeInstanceOf(FormData)
    expect(form.get("grant")).toBe("abc123")
    expect(form.get("path")).toBeNull()
    expect(Array.from(form.keys()).sort()).toEqual(["file", "grant"])
  })

  it("offers the file name to the chooser so the field opens on something sensible", async () => {
    responses = [json({ available: true, path: null, grant: null, confirmOverwrite: false })]

    await saveExport(new Blob(["x"]), { ...save, fileName: "My deck.apkg" })

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      title: "ExportSaveDialogTitle",
      fileName: "My deck.apkg",
    })
  })

  it("raises the host's reason when the write fails", async () => {
    responses = [
      json({ available: true, path: "/read-only/deck.mnemo", grant: "abc123", confirmOverwrite: false }),
      json({ error: "write_failed", message: "The file could not be written to that folder." }, 409),
    ]

    await expect(saveExport(new Blob(["x"]), save)).rejects.toThrow(ApiError)
  })

  it("falls back to the browser where there is no window to choose with", async () => {
    responses = [json({ available: false, path: null })]
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    const outcome = await saveExport(new Blob(["x"]), save)

    expect(outcome).toEqual({ status: "downloaded" })
    expect(click).toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    click.mockRestore()
  })

  // Byte fidelity across a real multipart parser and a real disk is proven by
  // Mnemo.Host.Tests/Lifecycle/ExportFileHttpTests.cs; fetch is stubbed here.
  it("hands the blob to the request untouched, whatever bytes are in it", async () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) bytes[i] = i
    hostSaves("/home/me/map.png")

    await saveExport(new Blob([bytes], { type: "image/png" }), { ...save, fileName: "map.png" })

    const carried = new Uint8Array(await (writeForm().get("file") as Blob).arrayBuffer())
    expect(carried).toEqual(bytes)
  })
})

describe("overwrite confirmation", () => {
  it("asks before replacing a file the chooser never mentioned", async () => {
    hostSaves("/home/me/deck.mnemo", true)

    const outcome = await saveExport(new Blob(["x"]), save)

    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "ExportOverwriteTitle",
        // The path goes into the copy, so the prompt names what is about to go.
        message: "A file already sits at /home/me/deck.mnemo.",
        destructive: true,
      }),
    )
    expect(outcome).toEqual({ status: "saved", path: "/home/me/deck.mnemo" })
  })

  it("writes nothing when the replacement is declined", async () => {
    hostSaves("/home/me/deck.mnemo", true)
    vi.mocked(dialog.confirm).mockResolvedValue(false)

    const outcome = await saveExport(new Blob(["x"]), save)

    expect(outcome).toEqual({ status: "cancelled" })
    expect(calls).toHaveLength(1)
  })

  it("does not ask when the chooser already confirmed the name", async () => {
    hostSaves("/home/me/deck.mnemo")

    await saveExport(new Blob(["x"]), save)

    expect(dialog.confirm).not.toHaveBeenCalled()
  })
})

describe("saveServerExport", () => {
  it("settles the destination before the export runs, so a cancel costs nothing", async () => {
    responses = [json({ available: true, path: null, grant: null, confirmOverwrite: false })]

    const outcome = await saveServerExport(save, sendExport)

    expect(outcome).toEqual({ status: "cancelled" })
    // The export route was never reached. That is the point: no package is built for a file
    // nobody is going to keep.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("/api/app/export-file/target")
  })

  it("hands the grant to the route that makes the file, so the bytes never come through here", async () => {
    hostSaves("/home/me/deck.mnemo")

    const outcome = await saveServerExport(save, sendExport)

    expect(outcome).toEqual({ status: "saved", path: "/home/me/deck.mnemo" })
    expect(calls[1].url).toBe("/api/flashcards/transfer/export")
    expect(JSON.parse(String(calls[1].init?.body)).grant).toBe("abc123")
  })

  it("takes the file itself where there is no window to choose with", async () => {
    responses = [
      json({ available: false, path: null, grant: null, confirmOverwrite: false }),
      new Response("payload", {
        status: 200,
        headers: { "Content-Disposition": `attachment; filename*=UTF-8''%E5%9C%B0%E5%9B%B3.mnemo` },
      }),
    ]

    const outcome = await saveServerExport(save, sendExport)

    expect(outcome).toEqual({ status: "downloaded" })
    expect(JSON.parse(String(calls[1].init?.body)).grant).toBeNull()
  })

  it("leaves the grant unspent when the replacement is declined", async () => {
    hostSaves("/home/me/deck.mnemo", true)
    vi.mocked(dialog.confirm).mockResolvedValue(false)

    const outcome = await saveServerExport(save, sendExport)

    expect(outcome).toEqual({ status: "cancelled" })
    expect(calls).toHaveLength(1)
  })

  it("throws the route's own message rather than a bare status", async () => {
    responses = [
      json({ available: true, path: "/home/me/deck.mnemo", grant: "abc123", confirmOverwrite: false }),
      json({ error: "no_decks", message: "No decks were selected to export." }, 400),
    ]

    await expect(saveServerExport(save, sendExport)).rejects.toThrow("No decks were selected to export.")
  })
})

/**
 * A dialog that names its destination in the footer settles it before the save, so the chooser has
 * already run by the time Save is pressed and must not run again.
 */
describe("a destination settled before the save", () => {
  const settled = { status: "chosen" as const, grant: "abc123", path: "/home/me/deck.mnemo" }

  it("writes without raising the chooser a second time", async () => {
    responses = [json({ path: "/home/me/deck.mnemo" })]

    const outcome = await saveServerExport(save, sendExport, settled)

    expect(outcome).toEqual({ status: "saved", path: "/home/me/deck.mnemo" })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("/api/flashcards/transfer/export")
  })

  it("asks again when the choice lapsed while the dialog sat open", async () => {
    responses = [
      json({ error: "unknown_grant", message: "That destination was not chosen, or the choice has lapsed." }, 400),
      json({ available: true, path: "/home/me/deck.mnemo", grant: "def456", confirmOverwrite: false }),
      json({ path: "/home/me/deck.mnemo" }),
    ]

    const outcome = await saveServerExport(save, sendExport, settled)

    expect(outcome).toEqual({ status: "saved", path: "/home/me/deck.mnemo" })
    expect(calls[1].url).toBe("/api/app/export-file/target")
    expect(JSON.parse(String(calls[2].init?.body)).grant).toBe("def456")
  })

  it("reports a write that failed for a real reason rather than asking again", async () => {
    responses = [json({ error: "write_failed", message: "The file could not be written to that folder." }, 409)]

    await expect(saveServerExport(save, sendExport, settled)).rejects.toThrow("could not be written")
    expect(calls).toHaveLength(1)
  })
})

describe("announceExport", () => {
  const strings = { title: "Export complete", downloaded: "Export finished." }

  it("says nothing about a cancelled save, which is what stops a false success", () => {
    expect(announceExport({ status: "cancelled" }, strings)).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("names the real path when the host wrote one", () => {
    expect(announceExport({ status: "saved", path: "/home/me/deck.mnemo" }, strings)).toBe(true)
    expect(toast.success).toHaveBeenCalledWith("Export complete", { description: "/home/me/deck.mnemo" })
  })

  it("falls back to the generic line when the browser took the file", () => {
    expect(announceExport({ status: "downloaded" }, strings)).toBe(true)
    expect(toast.success).toHaveBeenCalledWith("Export complete", { description: "Export finished." })
  })
})

describe("exportFileName", () => {
  it("opens the chooser on the one thing going out", () => {
    expect(exportFileName("Kanji stage 3", "flashcards", ".mnemo")).toBe("Kanji stage 3.mnemo")
  })

  it("falls back when a title is only characters a file system refuses", () => {
    expect(exportFileName("...", "flashcards", ".mnemo")).toBe("flashcards.mnemo")
  })

  it("keeps a separator out of what the chooser is handed", () => {
    expect(exportFileName("a/b", "notes", ".md")).toBe("a_b.md")
  })

  it("falls back on a Windows reserved device name", () => {
    expect(exportFileName("CON", "notes", ".md")).toBe("notes.md")
  })

  it("catches a reserved name regardless of case", () => {
    expect(exportFileName("com3", "notes", ".md")).toBe("notes.md")
  })

  it("catches a reserved name carrying its own extension-like suffix", () => {
    expect(exportFileName("nul.backup", "notes", ".md")).toBe("notes.md")
  })

  it("leaves a title that only starts with a reserved word alone", () => {
    expect(exportFileName("Console notes", "notes", ".md")).toBe("Console notes.md")
  })
})

/**
 * What the browser fallback names the file. Only reachable with no window to choose with, and only
 * the server's header knows the name by then, so the header is what is being read here.
 */
describe("the name a browser download lands under", () => {
  async function downloadWith(disposition: string | null): Promise<string> {
    const headers: Record<string, string> = disposition ? { "Content-Disposition": disposition } : {}
    responses = [
      json({ available: false, path: null, grant: null, confirmOverwrite: false }),
      new Response("payload", { status: 200, headers }),
    ]
    await saveServerExport(save, sendExport)
    return anchors[anchors.length - 1]?.download ?? ""
  }

  it("prefers the encoded form over the plain one", async () => {
    expect(
      await downloadWith(`attachment; filename="deck.mnemo"; filename*=UTF-8''%D0%BA%D0%BE%D0%BB%D0%BE%D0%B4%D0%B0.mnemo`),
    ).toBe("колода.mnemo")
  })

  it("falls back to the plain form when the encoding is malformed", async () => {
    expect(await downloadWith(`attachment; filename="deck.mnemo"; filename*=UTF-8''%E0%A4%A`)).toBe("deck.mnemo")
  })

  it("uses the name the chooser was offered when the header says nothing", async () => {
    expect(await downloadWith(null)).toBe("deck.mnemo")
  })
})
