import { MAX_QUEUED, type PickedFile } from "./import-queue"

type Root = FileSystemEntry | File

/** Read during the drop event, because the browser only hands out entries while it is live. */
export function dropRoots(data: DataTransfer): Root[] {
  const roots: Root[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue
    const entry = item.webkitGetAsEntry?.()
    const file = item.getAsFile()
    if (entry?.isDirectory) roots.push(entry)
    else if (file) roots.push(file)
  }
  return roots
}

/** Stops one past the queue limit so the queue can tell it is full. */
export async function walkDrop(roots: readonly Root[], accepts: (name: string) => boolean): Promise<PickedFile[]> {
  const found: PickedFile[] = []
  const visit = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (found.length > MAX_QUEUED || entry.name.startsWith(".")) return
    if (entry.isFile) {
      if (!accepts(entry.name)) return
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)).catch(
        () => null,
      )
      if (file) found.push({ file, path })
      return
    }
    const folder = path ? `${path}/${entry.name}` : entry.name
    for (const child of await readAll(entry as FileSystemDirectoryEntry)) await visit(child, folder)
  }

  for (const root of roots) {
    if (root instanceof File) found.push({ file: root, path: "" })
    else await visit(root, "")
  }
  return found
}

export function pickedFolder(files: readonly File[], accepts: (name: string) => boolean): PickedFile[] {
  const found: PickedFile[] = []
  for (const file of files) {
    const segments = (file.webkitRelativePath || file.name).split("/")
    if (segments.some((segment) => segment.startsWith(".")) || !accepts(file.name)) continue
    found.push({ file, path: segments.slice(0, -1).join("/") })
    if (found.length > MAX_QUEUED) break
  }
  return found
}

/** Entries come in batches until one comes back empty. */
async function readAll(folder: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = folder.createReader()
  const all: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject)).catch(
      () => [],
    )
    if (batch.length === 0) return all.sort((a, b) => a.name.localeCompare(b.name))
    all.push(...batch)
  }
}
