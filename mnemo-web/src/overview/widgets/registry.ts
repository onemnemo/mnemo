/**
 * Every widget this build ships, in the order the library lists them.
 *
 * The order is OverviewModule.RegisterWidgets', because that is what the desktop's library shows
 * and the two are meant to read the same. It is declaration order here for the same reason: a map
 * literal preserves insertion order, so the list and the lookup cannot drift apart.
 *
 * A widget id with no entry is not an error. The board renders it as an unavailable tile and keeps
 * its stored row intact, which is how a layout written by a build that had one more widget than
 * this one survives a round trip.
 */

import type { ComponentType } from "react"

import type { WidgetInstanceDto } from "@/api/types"

import type { ManifestLookup, WidgetManifest } from "./manifest"
import { WidgetPlaceholder } from "./WidgetPlaceholder"
import { flashcardMemoryManifest } from "./flashcard-memory/manifest"
import { flashcardStatsManifest } from "./flashcard-stats/manifest"
import { FlashcardStatsWidget } from "./flashcard-stats/FlashcardStatsWidget"
import { flashcardTestsManifest } from "./flashcard-tests/manifest"
import { recentDecksManifest } from "./recent-decks/manifest"
import { RecentNotesWidget } from "./recent-notes/RecentNotesWidget"
import { recentNotesManifest } from "./recent-notes/manifest"
import { StudyGoalsWidget } from "./study-goals/StudyGoalsWidget"
import { studyGoalsManifest } from "./study-goals/manifest"
import { UsageSummaryWidget } from "./usage-summary/UsageSummaryWidget"
import { usageSummaryManifest } from "./usage-summary/manifest"

/**
 * What a widget body is given. The instance carries the current size and the settings bag, so a
 * widget reads its own configuration rather than being handed decoded values it cannot re-derive.
 */
export interface WidgetProps {
  instance: WidgetInstanceDto
  manifest: WidgetManifest
}

export type WidgetComponent = ComponentType<WidgetProps>

export interface WidgetRegistration {
  manifest: WidgetManifest
  component: WidgetComponent
}

// Bodies still on the placeholder are the ones whose data path is not built yet. The manifests are
// final either way: they decide sizes, settings and library order, none of which wait on a fetch.
const REGISTRATIONS: readonly WidgetRegistration[] = [
  { manifest: flashcardStatsManifest, component: FlashcardStatsWidget },
  { manifest: flashcardMemoryManifest, component: WidgetPlaceholder },
  { manifest: flashcardTestsManifest, component: WidgetPlaceholder },
  { manifest: recentDecksManifest, component: WidgetPlaceholder },
  { manifest: recentNotesManifest, component: RecentNotesWidget },
  { manifest: studyGoalsManifest, component: StudyGoalsWidget },
  { manifest: usageSummaryManifest, component: UsageSummaryWidget },
]

const REGISTRY: ReadonlyMap<string, WidgetRegistration> = new Map(
  REGISTRATIONS.map((registration) => [registration.manifest.widgetId, registration]),
)

/** Every registration, in library order. */
export function allWidgets(): readonly WidgetRegistration[] {
  return [...REGISTRY.values()]
}

export function findWidget(widgetId: string): WidgetRegistration | undefined {
  return REGISTRY.get(widgetId)
}

/** The lookup the store and the seeder take, so neither has to import the registry itself. */
export const lookupManifest: ManifestLookup = (widgetId) => REGISTRY.get(widgetId)?.manifest
