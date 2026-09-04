import { AppIcon } from "@/components/icon/AppIcon"
import { FrameButton } from "@/components/shell/topbar/FrameButton"
import {
  Menu,
  MenuCheckItem,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubMenu,
  MenuTrigger,
} from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

import { peekAlphaOptions, usePeekStore, type PeekPlacement, type PeekSide } from "./store"

const BUTTON_CLASS = "size-7"

/**
 * The peek's title bar.
 *
 * Everything that changes the panel itself is in the overflow menu, and everything that
 * acts on what the panel is showing is a button: the header is read at a glance while
 * the reader's attention is on the canvas behind it, so the two kinds of control do not
 * share a row of identical glyphs.
 */
export function PeekHeader({
  title,
  subtitle,
  onOpenFull,
}: {
  title: string
  subtitle?: string
  /** Absent for an item with no full surface of its own. */
  onOpenFull?: () => void
}) {
  const t = useT()
  const placement = usePeekStore((s) => s.placement)
  const side = usePeekStore((s) => s.side)
  const pinned = usePeekStore((s) => s.pinned)
  const alpha = usePeekStore((s) => s.alpha)

  const overlay = placement === "overlay"

  const dockTo = (next: PeekSide) => {
    usePeekStore.getState().setPlacement("docked")
    usePeekStore.getState().setSide(next)
  }

  const placeAs = (next: PeekPlacement) => usePeekStore.getState().setPlacement(next)

  return (
    <header className="flex h-11 shrink-0 items-center gap-0.5 pr-1.5 pl-3">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
        {title}
        {subtitle ? <span className="ml-1.5 font-normal text-ink-3">{subtitle}</span> : null}
      </span>

      {pinned ? (
        <span className="grid size-7 shrink-0 place-items-center text-ink-3" aria-hidden>
          <AppIcon name="common/pin" size={13} />
        </span>
      ) : null}

      <FrameButton
        icon="common/refresh"
        label={t("App", "PeekRefresh")}
        onClick={() => usePeekStore.getState().refreshPeek()}
        className={BUTTON_CLASS}
      />

      {onOpenFull ? (
        <FrameButton
          icon="maximize"
          label={t("App", "PeekOpenFull")}
          onClick={onOpenFull}
          className={BUTTON_CLASS}
        />
      ) : null}

      <Menu>
        <MenuTrigger asChild>
          <FrameButton icon="ellipsis" label={t("App", "PeekOptions")} className={BUTTON_CLASS} />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon="common/pin" onSelect={() => usePeekStore.getState().togglePinned()}>
            {pinned ? t("App", "PeekUnpin") : t("App", "PeekPin")}
          </MenuItem>
          <MenuSeparator />
          <MenuCheckItem icon="layers" checked={overlay} onSelect={() => placeAs("overlay")}>
            {t("App", "PeekOverlay")}
          </MenuCheckItem>
          <MenuCheckItem
            icon="common/panel-right"
            checked={!overlay && side === "right"}
            onSelect={() => dockTo("right")}
          >
            {t("App", "PeekDockRight")}
          </MenuCheckItem>
          <MenuCheckItem
            icon="panel-left"
            checked={!overlay && side === "left"}
            onSelect={() => dockTo("left")}
          >
            {t("App", "PeekDockLeft")}
          </MenuCheckItem>

          {/* Docked, the peek has a column of its own and there is nothing behind it
              for a thinner background to reveal. */}
          {overlay ? (
            <>
              <MenuSeparator />
              <MenuSubMenu label={t("App", "PeekBackground")} icon="eye">
                <MenuRadioGroup
                  value={String(alpha)}
                  onValueChange={(value) => usePeekStore.getState().setAlpha(Number(value))}
                >
                  {peekAlphaOptions().map((option) => (
                    <MenuRadioItem key={option} value={String(option)}>
                      {t("App", "PeekBackgroundFormat", { 0: option })}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubMenu>
            </>
          ) : null}

          {/* Overlay only, for the same reason the store clears collapse when the
              placement changes: a docked rail is a whole column showing thirty pixels of
              nothing. */}
          {overlay ? (
            <>
              <MenuSeparator />
              <MenuItem
                icon={side === "right" ? "common/panel-right" : "panel-left"}
                onSelect={() => usePeekStore.getState().toggleCollapsed()}
              >
                {t("App", "PeekCollapse")}
              </MenuItem>
            </>
          ) : null}
        </MenuContent>
      </Menu>

      <FrameButton
        icon="x"
        label={t("Common", "Close")}
        onClick={() => usePeekStore.getState().closePeek()}
        className={BUTTON_CLASS}
      />
    </header>
  )
}
