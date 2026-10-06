import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { Tooltip } from "@/components/ui/tooltip"
import { useT } from "@/i18n/useT"
import { Sep, Slot } from "@/mindmap/chrome/bits"

import type { OcclusionEditor } from "../useOcclusionEditor"
import type { ActionChords } from "./useActionChords"

/** Zoom, fit and the Show masks switch, in the bottom right corner of the image area. */
export function OcclusionViewDock({ editor, chords }: { editor: OcclusionEditor; chords: ActionChords }) {
  const t = useT()
  const { store, state, zoomPercent } = editor
  const icon = (name: string) => <AppIcon name={name} size={16} strokeWidth={1.8} />
  const label = (key: string) => t("Flashcards", key)

  return (
    <div className="pointer-events-none absolute right-4 bottom-4 z-40">
      <div
        role="group"
        aria-label={label("OcclusionViewLabel")}
        className="pointer-events-auto flex h-10 items-center gap-0.5 rounded-[13px] bg-surface-float p-1 shadow-float"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Slot label={label("OcclusionZoomOut")} chord={chords.chord("zoom-out")} onClick={() => store.zoomOut()}>
          {icon("minus")}
        </Slot>

        <Menu>
          <Tooltip label={label("OcclusionZoom")}>
            <MenuTrigger asChild>
              <button
                type="button"
                aria-label={label("OcclusionZoom")}
                className="flex h-7 min-w-[58px] shrink-0 items-center justify-center gap-0.5 rounded-[7px] pl-1 text-[12px] font-medium text-ink tabular-nums transition-colors duration-120 outline-none hover:bg-frame-hover focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-frame-active"
              >
                {`${zoomPercent ?? 100}%`}
                <AppIcon name="chevron-up" size={11} strokeWidth={2.4} className="text-ink-3" />
              </button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent align="end">
            <MenuItem hint={chords.hint("zoom-in")} onSelect={() => store.zoomIn()}>
              {label("OcclusionZoomIn")}
            </MenuItem>
            <MenuItem hint={chords.hint("zoom-out")} onSelect={() => store.zoomOut()}>
              {label("OcclusionZoomOut")}
            </MenuItem>
            <MenuItem onSelect={() => store.zoomTo(100)}>{label("OcclusionZoomTo100")}</MenuItem>
            <MenuItem hint={chords.hint("zoom-fit")} onSelect={() => store.fit()}>
              {label("OcclusionFit")}
            </MenuItem>
          </MenuContent>
        </Menu>

        <Slot label={label("OcclusionZoomIn")} chord={chords.chord("zoom-in")} onClick={() => store.zoomIn()}>
          {icon("plus")}
        </Slot>
        <Slot label={label("OcclusionFit")} chord={chords.chord("zoom-fit")} onClick={() => store.fit()}>
          {icon("maximize")}
        </Slot>

        <Sep />

        <Slot
          label={label("OcclusionShowMasks")}
          chord={chords.chord("toggle-masks")}
          active={state.showMasks}
          onClick={() => store.setShowMasks(!state.showMasks)}
        >
          {icon("eye")}
        </Slot>
      </div>
    </div>
  )
}
