import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

import { Row } from "../kit"

const NS = "Settings"

/**
 * One language in the active set.
 *
 * There is no switch. A row in a list of the languages being checked has one
 * reachable state, so membership is the `...` menu's Remove and nothing else.
 * Order is invisible unless something says so and it decides whose corrections
 * are offered first, which is what the tag on the first row is for.
 */
export function ProofingLanguageRow({
  label,
  state,
  primary,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  label: string
  /** Null on a dictionary that simply works, which needs no caption of its own. */
  state: string | null
  primary: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const t = useT()
  const st = (key: string, params?: Record<string, string | number>) => t(NS, key, params)

  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          <span className="truncate">{label}</span>
          {primary && (
            <span className="shrink-0 rounded-md bg-canvas-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-3">
              {st("ProofingSuggestsFirst")}
            </span>
          )}
        </span>
      }
      description={state ?? undefined}
    >
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={st("ProofingLanguageOptionsFormat", { 0: label })}
            className="grid size-7 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink data-[state=open]:bg-frame-active"
          >
            <AppIcon name="ellipsis" size={16} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon="arrow-up" disabled={!canMoveUp} onSelect={onMoveUp}>
            {st("ProofingMoveUp")}
          </MenuItem>
          <MenuItem icon="arrow-down" disabled={!canMoveDown} onSelect={onMoveDown}>
            {st("ProofingMoveDown")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="trash-2" danger onSelect={onRemove}>
            {st("ProofingRemoveLanguage")}
          </MenuItem>
        </MenuContent>
      </Menu>
    </Row>
  )
}
