import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from "react"
import { DropdownMenu } from "radix-ui"

import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { CONTENT_CLASS } from "@/components/ui/menu-styles"
import { useT } from "@/i18n/useT"

import { cameraSignal } from "../canvas/camera-signal"
import type { MindmapEditor } from "../edit/useMindmapEditor"
import { selectOnly, type Selection } from "../interaction/selection"
import type { Scene } from "../model/scene"
import { runImageAction, type ImageAction } from "./image-actions"
import { isImageSlot } from "./image-fill"
import { focusCanvas, isChromeControl, isTyping } from "./route-guards"

export type ImageMenuRow =
  | { readonly id: ImageAction | "choose"; readonly label: string; readonly icon: string; readonly danger?: boolean }
  | "separator"

const DELETE_ROW: ImageMenuRow = { id: "delete", label: "Delete", icon: "common/trash", danger: true }

/** What the menu offers: the full set on a picture, and only a way in or out on an empty one. */
export function imageMenuRows(filled: boolean): readonly ImageMenuRow[] {
  if (!filled) {
    return [{ id: "choose", label: "ImageChoose", icon: "image-plus" }, "separator", DELETE_ROW]
  }
  return [
    { id: "replace", label: "ImageReplace", icon: "image-plus" },
    { id: "crop", label: "ImageCrop", icon: "crop" },
    "separator",
    { id: "copy", label: "ImageCopy", icon: "copy" },
    { id: "download", label: "ImageDownload", icon: "download" },
    "separator",
    { id: "remove", label: "ImageRemove", icon: "eraser" },
    DELETE_ROW,
  ]
}

interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

function nodeOf(pane: HTMLElement | null, id: string): HTMLElement | undefined {
  return [...(pane?.querySelectorAll<HTMLElement>(".mm-node") ?? [])].find((node) => node.dataset.mmId === id)
}

interface ImageMenuHost {
  readonly stage: RefObject<HTMLDivElement | null>
  readonly scene: Scene | null
  readonly selection: Selection
  readonly setSelection: (next: Selection) => void
  readonly editor: MindmapEditor
  readonly pick: (id: string) => void
}

/**
 * The menu on an image element. A right click or the menu key hangs it from the element's box, and the
 * options pill from the pill, the way the notes pill does. It closes when the camera moves, since what
 * it hangs from has moved.
 */
export function useImageMenu({ stage, scene, selection, setSelection, editor, pick }: ImageMenuHost) {
  const t = useT()
  const [open, setOpen] = useState<{ id: string; box: Box; fromPill: boolean } | null>(null)
  const latest = useRef(scene)
  useEffect(() => {
    latest.current = scene
  }, [scene])

  const openFor = useCallback(
    (id: string, fromPill = false): boolean => {
      const pane = stage.current
      const node = nodeOf(pane, id)
      const host = fromPill ? node?.querySelector<HTMLElement>('[data-mm-chrome="imageMenu"]') : node
      if (!pane || !host) {
        return false
      }
      // Clamped to the pane, so a picture larger than the view still gets its menu on screen.
      const bounds = pane.getBoundingClientRect()
      const rect = host.getBoundingClientRect()
      const left = Math.max(rect.left, bounds.left)
      const top = Math.max(rect.top, bounds.top)
      const right = Math.min(rect.right, bounds.right)
      const bottom = Math.min(rect.bottom, bounds.bottom)
      setOpen({
        id,
        fromPill,
        box: {
          left: left - bounds.left,
          top: top - bounds.top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        },
      })
      return true
    },
    [stage],
  )

  /** Opens the menu on the one selected image, for the menu key and Shift+F10. False when there is none. */
  const openOnSelection = useCallback((): boolean => {
    const only = selection.elements.size === 1 ? [...selection.elements][0] : null
    const element = only ? scene?.elements.find((candidate) => candidate.id === only) : null
    return element?.kind === "image" ? openFor(element.id) : false
  }, [openFor, scene, selection])

  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('[role="menu"]')) {
        event.preventDefault()
        return
      }
      if (isTyping(target) || isChromeControl(target)) {
        return
      }
      const id = target?.closest?.<HTMLElement>(".mm-node")?.dataset.mmId
      const element = id ? scene?.elements.find((candidate) => candidate.id === id) : null
      if (element?.kind === "image") {
        event.preventDefault()
        setSelection(selectOnly("element", element.id))
        openFor(element.id)
        return
      }
      // The menu key arrives as a context menu on the focused canvas, with no pointer behind it. A
      // long press with a finger or pen on empty canvas has one, and is not asking about the selection.
      const pointerType = (event.nativeEvent as Partial<PointerEvent>).pointerType
      if (!id && !pointerType && event.button !== 2 && openOnSelection()) {
        event.preventDefault()
      }
    },
    [openFor, openOnSelection, scene, setSelection],
  )

  useEffect(() => {
    if (!open) {
      return
    }
    return cameraSignal.subscribe(() => setOpen(null))
  }, [open])

  /** The options pill on a picture: the same menu, hung from the pill rather than the picture. */
  const openFromPill = useCallback(
    (id: string) => {
      setSelection(selectOnly("element", id))
      openFor(id, true)
    },
    [openFor, setSelection],
  )

  // Keeps the pill up while its menu is, which the node cannot know for itself: it renders once per element.
  const openId = open?.id ?? null
  useEffect(() => {
    const node = openId ? nodeOf(stage.current, openId) : null
    if (!node) {
      return
    }
    node.dataset.mmMenu = ""
    return () => {
      delete node.dataset.mmMenu
    }
  }, [openId, stage])

  // Undo, or an edit from elsewhere, can take the element away while its menu is up.
  useEffect(() => {
    if (openId && !scene?.elements.some((element) => element.id === openId)) {
      setOpen(null)
    }
  }, [openId, scene])

  const element = openId ? scene?.elements.find((candidate) => candidate.id === openId) : null
  const rows = imageMenuRows(element !== null && element !== undefined && !isImageSlot(element))

  const run = (id: string, action: ImageMenuRow) => {
    if (action === "separator") {
      return
    }
    if (action.id === "choose") {
      pick(id)
      return
    }
    void runImageAction({ editor, scene: () => latest.current, t }, id, action.id)
  }

  const box = open?.box ?? { left: 0, top: 0, width: 0, height: 0 }
  const menu = (
    <Menu open={open !== null} onOpenChange={(next) => (next ? undefined : setOpen(null))}>
      <MenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute" style={box} />
      </MenuTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align={open?.fromPill ? "end" : "start"}
          sideOffset={6}
          collisionPadding={8}
          aria-label={t("Mindmap", "ImageOptions")}
          className={CONTENT_CLASS}
          // Back to the map rather than to the invisible anchor, which is not something that hears keys.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            focusCanvas(stage.current)
          }}
        >
          {rows.map((row, index) =>
            row === "separator" ? (
              <MenuSeparator key={`sep${index}`} />
            ) : (
              <MenuItem
                key={row.id}
                icon={row.icon}
                danger={row.danger}
                onSelect={() => {
                  if (openId) run(openId, row)
                }}
              >
                {t("Mindmap", row.label)}
              </MenuItem>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </Menu>
  )

  return { isOpen: open !== null, openOnSelection, openFromPill, onContextMenu, menu }
}
