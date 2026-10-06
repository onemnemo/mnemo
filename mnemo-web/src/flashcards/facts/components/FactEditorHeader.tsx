import type { ReactNode } from "react"
import { Dialog } from "radix-ui"

import { IconButton } from "@/components/ui/icon-button"
import { Tooltip } from "@/components/ui/tooltip"
import { useT } from "@/i18n/useT"
import { SelectControl, type SelectChoice } from "@/settings/components/controls/SelectControl"
import { cn } from "@/lib/utils"

export interface FactEditorHeaderProps {
  title: string
  deckId: string
  deckChoices: SelectChoice[]
  onDeck: (deckId: string) => void
  typeId: string
  typeChoices: SelectChoice[]
  onType: (typeId: string) => void
  /** When set, the type cannot change, and this says why. */
  typeLockedReason?: string
  className?: string
  /** Controls placed between the type select and the close button. */
  children?: ReactNode
}

/** The title, deck select, card type select and close button every layout of the editor shares. */
export function FactEditorHeader(props: FactEditorHeaderProps) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <div className={cn("flex items-center gap-3.5 border-b border-line-soft", props.className)}>
      <Dialog.Title className="text-[14px] font-semibold text-ink">{props.title}</Dialog.Title>
      <SelectControl
        value={props.deckId}
        choices={props.deckChoices}
        onChange={props.onDeck}
        label={fc("ColDeck")}
        className="min-w-[180px]"
      />
      <div className="flex-1" />
      {/* The disabled trigger takes no pointer events, so the hint sits on a wrapper. */}
      <Tooltip label={props.typeLockedReason ?? ""}>
        <span className="inline-flex">
          <SelectControl
            value={props.typeId}
            choices={props.typeChoices}
            onChange={props.onType}
            disabled={props.typeLockedReason !== undefined}
            label={fc("CardTypeLabel")}
            className="min-w-[150px]"
          />
        </span>
      </Tooltip>
      {props.children}
      <Dialog.Close asChild>
        <IconButton icon="common/x" iconSize={14} label={t("Common", "Close")} />
      </Dialog.Close>
    </div>
  )
}
