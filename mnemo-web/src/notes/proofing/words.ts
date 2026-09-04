/**
 * How two spellings of one word are compared on this side of the wire.
 *
 * The host folds a word to composed form before comparing it, because an editor
 * and a dictionary can encode the same accent two ways. Anything here that
 * matches text against a stored word has to fold it the same way or the two
 * halves disagree about what is already accepted.
 */

export function foldWord(word: string): string {
  return word.trim().normalize('NFC').toLowerCase();
}

/**
 * The words that are in one list and not the other, folded.
 *
 * Both an addition and a removal have to reach the editor: one takes an
 * underline away and the other puts one back, and neither is visible in the
 * lists alone.
 */
export function changedWords(before: readonly string[], after: readonly string[]): string[] {
  const first = new Set(before.map(foldWord));
  const second = new Set(after.map(foldWord));
  const changed: string[] = [];

  for (const word of first) if (!second.has(word)) changed.push(word);
  for (const word of second) if (!first.has(word)) changed.push(word);

  return changed;
}
