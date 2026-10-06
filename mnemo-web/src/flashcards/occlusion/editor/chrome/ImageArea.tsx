import { useRef, type KeyboardEvent, type MouseEvent } from "react"

import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { useT } from "@/i18n/useT"
import { isEditableTarget } from "@/keybinds/chord"

import { cardCountOf } from "../cards"
import { EditorStage } from "../EditorStage"
import { hitMask, pointToImage } from "../hit"
import type { EditorAction } from "../keys"
import { boxOfMasks } from "../ops"
import { frameOf } from "../state"
import type { OcclusionEditor } from "../useOcclusionEditor"
import { MaskMenuContent } from "./MaskMenu"
import { maskMenuItems } from "./mask-menu"
import { OcclusionSelectionBar } from "./OcclusionSelectionBar"
import { OcclusionToolbar } from "./OcclusionToolbar"
import { OcclusionViewDock } from "./OcclusionViewDock"
import type { ActionChords } from "./useActionChords"

/** The image with its masks and everything that floats over it: tools, view controls, selection bar. */
export function ImageArea({
  editor,
  imageUrl,
  imageFailed = false,
  chords,
  compact,
}: {
  editor: OcclusionEditor
  imageUrl: string | null
  imageFailed?: boolean
  chords: ActionChords
  /** A narrow window: the tool bar moves to the left to clear the view controls. */
  compact: boolean
}) {
  const t = useT()
  const { store, state, document, selection, selectionIsGroup } = editor
  const picked = useRef<EditorAction | null>(null)
  const items = maskMenuItems(t, { cards: cardCountOf(document, selection), isGroup: selectionIsGroup }, chords.hint)

  const fromKeys = useRef(false)

  // The menu belongs to masks: anywhere else on the image it stays shut. The stage has already
  // selected the mask under the pointer by the time this runs.
  const guardMenu = (event: MouseEvent<HTMLElement>) => {
    if (fromKeys.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const point = pointToImage({ x: event.clientX, y: event.clientY }, rect, frameOf(store.getState()))
    if (!hitMask(store.doc(), point)) event.preventDefault()
  }

  const isMenuKey = (event: KeyboardEvent) => event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")

  // The menu key and Shift+F10 raise a context menu at a point that means nothing here, so the
  // menu is opened by hand over the selection instead.
  const openFromKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (!isMenuKey(event) || isEditableTarget(event.target)) return
    event.preventDefault()
    const box = selection.length > 0 ? boxOfMasks(document, selection) : null
    if (!box) return
    const pane = event.currentTarget.getBoundingClientRect()
    const frame = frameOf(store.getState())
    fromKeys.current = true
    event.currentTarget.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: pane.left + frame.x + (box.x + box.w / 2) * frame.w,
        clientY: pane.top + frame.y + (box.y + box.h / 2) * frame.h,
      }),
    )
    fromKeys.current = false
  }

  return (
    <div className="absolute inset-0">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="size-full"
            onContextMenu={guardMenu}
            onKeyDown={openFromKeys}
            // Windows raises the menu when the key comes back up.
            onKeyUp={(event) => {
              if (isMenuKey(event)) event.preventDefault()
            }}
          >
            <EditorStage editor={editor} imageUrl={imageUrl} imageFailed={imageFailed} />
          </div>
        </ContextMenuTrigger>
        <MaskMenuContent items={items} keepFocusAfter={picked} onPick={(action) => editor.perform(action)} />
      </ContextMenu>

      {editor.zoomPercent !== null ? (
        <>
          <OcclusionSelectionBar editor={editor} chords={chords} />
          <OcclusionToolbar tool={state.tool} onTool={(tool) => store.setTool(tool)} chords={chords} compact={compact} />
          <OcclusionViewDock editor={editor} chords={chords} />
        </>
      ) : null}
    </div>
  )
}
