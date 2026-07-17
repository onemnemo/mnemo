import { Crumbs } from "@/components/shell/topbar/Crumbs"
import { NotificationBell } from "@/components/shell/topbar/NotificationBell"
import { ProfileButton } from "@/components/shell/topbar/ProfileButton"
import { SearchTrigger } from "@/components/shell/topbar/SearchTrigger"

// Reference layout is [crumbs][search][spacer][right cluster]. The right cluster
// omits gamification (needs data) and window min/max/close (the OS titlebar owns
// those until a chromeless PhotinoX drag API exists, per the Phase 1 spike).
export function Topbar({ title }: { title: string }) {
  return (
    <header
      className="flex shrink-0 items-center border-b-[0.8px] border-[var(--topbar-border)] bg-[var(--topbar-background)] p-[var(--topbar-inset)]"
      style={{ height: "var(--topbar-height)" }}
    >
      <Crumbs title={title} />
      <SearchTrigger />
      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <ProfileButton />
      </div>
    </header>
  )
}
