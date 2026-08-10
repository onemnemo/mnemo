/**
 * Every widget this build ships, in the order the library lists them.
 *
 * One flat list. Everything the board and the library need about a widget lives in its manifest,
 * so adding a widget is one entry here and no edits anywhere else. That is the shape an extension
 * store needs later: a third party ships a manifest and a component, not a patch to the board.
 *
 * A widget id with no entry is not an error. The board renders it as an unavailable tile and keeps
 * its stored row intact, which is how a layout written by a build with one more widget than this
 * one survives a round trip, and how the two widgets this catalogue dropped leave a removable tile
 * rather than a hole.
 */

import type { ComponentType } from "react"

import type { WidgetInstanceDto } from "@/api/types"

import type { ManifestLookup, WidgetManifest } from "./manifest"
import { ActivityWidget } from "./activity/ActivityWidget"
import { activityManifest } from "./activity/manifest"
import { DeckSpotlightWidget } from "./deck-spotlight/DeckSpotlightWidget"
import { deckSpotlightManifest } from "./deck-spotlight/manifest"
import { FlashcardMemoryWidget } from "./flashcard-memory/FlashcardMemoryWidget"
import { flashcardMemoryManifest } from "./flashcard-memory/manifest"
import { FlashcardTestsWidget } from "./flashcard-tests/FlashcardTestsWidget"
import { flashcardTestsManifest } from "./flashcard-tests/manifest"
import { ForecastWidget } from "./forecast/ForecastWidget"
import { forecastManifest } from "./forecast/manifest"
import { LeechesWidget } from "./leeches/LeechesWidget"
import { leechesManifest } from "./leeches/manifest"
import { RecentWidget } from "./recent/RecentWidget"
import { recentManifest } from "./recent/manifest"
import { RecentNotesWidget } from "./recent-notes/RecentNotesWidget"
import { recentNotesManifest } from "./recent-notes/manifest"
import { SomaWidget } from "./soma/SomaWidget"
import { somaManifest } from "./soma/manifest"
import { StreakWidget } from "./streak/StreakWidget"
import { streakManifest } from "./streak/manifest"
import { StudyGoalsWidget } from "./study-goals/StudyGoalsWidget"
import { studyGoalsManifest } from "./study-goals/manifest"
import { TodayWidget } from "./today/TodayWidget"
import { todayManifest } from "./today/manifest"
import { UsageSummaryWidget } from "./usage-summary/UsageSummaryWidget"
import { usageSummaryManifest } from "./usage-summary/manifest"

/**
 * What a widget body is given. The instance carries the current size and the settings bag, so a
 * widget reads its own configuration rather than being handed decoded values it cannot re-derive.
 */
export interface WidgetProps {
  instance: WidgetInstanceDto
  manifest: WidgetManifest
  /**
   * The width the widget should *compose* for, which is not always the width it was authored at.
   *
   * In a one-column grid every tile spans the board, so a 1x1 asked to draw its narrow composition
   * ends up as a single stat marooned in four hundred pixels of nothing. Widgets branch on this
   * rather than on `instance.size.columns`, which stays the stored span.
   */
  renderColumns: number
}

export type WidgetComponent = ComponentType<WidgetProps>

export interface WidgetRegistration {
  manifest: WidgetManifest
  component: WidgetComponent
}

const REGISTRATIONS: readonly WidgetRegistration[] = [
  { manifest: todayManifest, component: TodayWidget },
  { manifest: recentManifest, component: RecentWidget },
  { manifest: streakManifest, component: StreakWidget },
  { manifest: activityManifest, component: ActivityWidget },
  { manifest: forecastManifest, component: ForecastWidget },
  { manifest: flashcardMemoryManifest, component: FlashcardMemoryWidget },
  { manifest: studyGoalsManifest, component: StudyGoalsWidget },
  { manifest: leechesManifest, component: LeechesWidget },
  { manifest: deckSpotlightManifest, component: DeckSpotlightWidget },
  { manifest: flashcardTestsManifest, component: FlashcardTestsWidget },
  { manifest: recentNotesManifest, component: RecentNotesWidget },
  { manifest: usageSummaryManifest, component: UsageSummaryWidget },
  { manifest: somaManifest, component: SomaWidget },
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
