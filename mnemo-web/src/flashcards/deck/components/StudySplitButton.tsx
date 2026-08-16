import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSectionLabel, MenuSeparator, MenuSubMenu, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

/**
 * The Study control: a primary segment that starts a review straight away and a
 * chevron segment holding the other session modes. Split rather than a plain menu
 * because starting a review is the one thing this page exists for, so the common
 * case is one click and the modes are one more.
 */
export function StudySplitButton({
  deckId,
  dueCount,
  allCount,
}: {
  deckId: string
  dueCount: number
  allCount: number
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <div className="flex h-8 items-stretch">
      <button
        type="button"
        onClick={() => navigate("flashcard-session", deckId, "review", "due")}
        className="flex items-center gap-1.5 rounded-lg rounded-r-none bg-solid pr-2.5 pl-3 text-[13px] font-medium tracking-[-0.006em] text-solid-fg transition-colors hover:bg-solid-hover"
      >
        <AppIcon name="common/play-filled" size={13} />
        {fc("Study")}
      </button>

      {/* Hairline seam between the segments, drawn against the button's own text
          colour rather than as a themed border: it sits on one fill, not between
          two surfaces. */}
      <span className="w-px bg-solid-fg/20" />

      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={fc("StudyModes")}
            className="grid w-7 place-items-center rounded-lg rounded-l-none bg-solid text-solid-fg transition-colors hover:bg-solid-hover"
          >
            <AppIcon name="common/chevron-down" size={13} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem
            icon="common/play"
            hint={fc("StudyMenuHintReview")}
            emphasis={dueCount > 0}
            onSelect={() => navigate("flashcard-session", deckId, "review", "due")}
          >
            {fc("SessionReview")}
          </MenuItem>
          <MenuSeparator />
          <MenuSectionLabel>{fc("StudyPracticeSectionHeader")}</MenuSectionLabel>
          <MenuSubMenu
            label={fc("SessionCram")}
            icon="common/repeat"
            hint={fc("StudyMenuHintCram")}
            emphasis={dueCount === 0}
          >
            <MenuSectionLabel>{fc("StudyCramSectionHeader")}</MenuSectionLabel>
            <MenuItem
              hint={dueCount.toLocaleString()}
              onSelect={() => navigate("flashcard-session", deckId, "cram", "due")}
            >
              {fc("StudyCramDueCards")}
            </MenuItem>
            <MenuItem
              hint={allCount.toLocaleString()}
              onSelect={() => navigate("flashcard-session", deckId, "cram", "all")}
            >
              {fc("StudyCramAllCards")}
            </MenuItem>
          </MenuSubMenu>
          <MenuItem
            icon="common/pencil"
            hint={fc("StudyMenuHintTest")}
            onSelect={() => navigate("flashcard-test", deckId)}
          >
            {fc("SessionTest")}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}
