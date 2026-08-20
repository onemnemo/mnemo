/**
 * The hour a study day rolls over at, as the host resolves it.
 *
 * Every widget that asks what today is goes through this, so a board cannot render one tile on the
 * collection's boundary and another on UTC's. While the read is in flight it answers the seeded
 * default, which is what almost every profile stores, and the widgets re-derive their window when
 * the real value arrives.
 */

import { useStudyDay } from "../api"
import { DEFAULT_DAY_START_HOUR } from "../stats"

export function useDayStartHour(): number {
  return useStudyDay().data?.dayStartHour ?? DEFAULT_DAY_START_HOUR
}
