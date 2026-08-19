/**
 * At and above this many lapses a card is worth calling out: it keeps being forgotten rather than
 * having gone wrong once.
 *
 * This is a display line, not the scheduler's. A preset decides how many lapses a card is actually
 * allowed before it is tagged or suspended, and that number is per preset and deliberately higher.
 * The deck browser and the dashboard tile both point here so they agree with each other, which
 * they did not when each carried its own count.
 */
export const LEECH_LAPSES = 3
