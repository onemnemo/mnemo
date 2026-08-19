import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { useDecksQuery } from "@/flashcards/api"
import { useT } from "@/i18n/useT"

/**
 * The deck picker a row grows when its restore comes back asking where to put something.
 *
 * Only flashcard material and cards can ask: they are the only content that outlives its
 * container, because a deck row can be destroyed while a card that belonged to it is still in
 * the trash. Everything else either carries its own place or is refiled at a root.
 *
 * Its own file, and the one place in the trash that knows another module exists. When a second
 * kind needs somewhere to go, this is what gets a sibling rather than what gets a parameter.
 */
export function DestinationMenu({
  label,
  disabled,
  onChoose,
}: {
  label: string
  disabled?: boolean
  onChoose: (deckId: string) => void
}) {
  const t = useT()
  const decks = useDecksQuery()
  const sorted = [...(decks.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          icon={<AppIcon name="common/folder" size={13} strokeWidth={1.7} />}
        >
          {label}
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {sorted.length === 0 ? (
          <MenuItem disabled>{t("Trash", "NoDecks")}</MenuItem>
        ) : (
          sorted.map((deck) => (
            <MenuItem key={deck.id} onSelect={() => onChoose(deck.id)}>
              {deck.name}
            </MenuItem>
          ))
        )}
      </MenuContent>
    </Menu>
  )
}
