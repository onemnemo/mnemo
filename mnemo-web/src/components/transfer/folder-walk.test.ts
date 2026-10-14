import { describe, expect, it } from "vitest"

import { pickedFolder, walkDrop } from "./folder-walk"

const accepts = (name: string) => name.endsWith(".md")

/** Hands out children two at a time, like a real reader. */
function folder(name: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let next = 0
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
          resolve(children.slice(next, next + 2))
          next += 2
        },
      }
    },
  } as unknown as FileSystemDirectoryEntry
}

function file(name: string): FileSystemFileEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (file: File) => void) => resolve(new File(["x"], name)),
  } as unknown as FileSystemFileEntry
}

describe("walkDrop", () => {
  it("reads every batch, keeps folder paths and skips dot folders and other files", async () => {
    const vault = folder("Vault", [
      file("b.md"),
      folder("Biology", [file("Cells.md"), file("photo.png")]),
      folder(".obsidian", [file("config.md")]),
      file(".hidden.md"),
      file("a.md"),
    ])
    const loose = new File(["x"], "loose.txt")

    const found = await walkDrop([vault, loose], accepts)

    expect(found.map(({ file, path }) => `${path}|${file.name}`)).toEqual([
      "Vault|a.md",
      "Vault|b.md",
      "Vault/Biology|Cells.md",
      "|loose.txt",
    ])
  })
})

describe("pickedFolder", () => {
  it("takes the folder path from the picker's relative path", () => {
    const named = (path: string) => {
      const picked = new File(["x"], path.split("/").pop()!)
      Object.defineProperty(picked, "webkitRelativePath", { value: path })
      return picked
    }

    const found = pickedFolder(
      [named("Vault/Biology/Cells.md"), named("Vault/.trash/Old.md"), named("Vault/image.png"), named("Vault/a.md")],
      accepts,
    )

    expect(found.map(({ file, path }) => `${path}|${file.name}`)).toEqual(["Vault/Biology|Cells.md", "Vault|a.md"])
  })
})
