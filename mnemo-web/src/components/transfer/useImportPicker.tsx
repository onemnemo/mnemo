import { useRef, type ReactNode } from "react"

import type { PickedFile } from "./import-queue"

/** Hidden file inputs for the drop area and the Add menu. They sit outside the panel because Add is in the footer. */
export function useImportPicker({
  extensions,
  onAdd,
  onPickFolder,
}: {
  extensions: string[]
  onAdd: (files: PickedFile[]) => void
  /** Omit for a module that cannot take a folder. Add is then a plain file button. */
  onPickFolder?: (files: File[]) => void
}): { inputs: ReactNode; browse: () => void; browseFolder: () => void } {
  const input = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const inputs = (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={extensions.join(",")}
        onChange={(event) => {
          onAdd(Array.from(event.target.files ?? [], (file) => ({ file, path: "" })))
          // Cleared so picking the same file again still fires a change.
          event.target.value = ""
        }}
      />
      {onPickFolder ? (
        <input
          // React has no typed prop for the folder picker attribute.
          ref={(element) => {
            folderInput.current = element
            element?.setAttribute("webkitdirectory", "")
          }}
          type="file"
          hidden
          onChange={(event) => {
            onPickFolder(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
      ) : null}
    </>
  )

  return { inputs, browse: () => input.current?.click(), browseFolder: () => folderInput.current?.click() }
}
