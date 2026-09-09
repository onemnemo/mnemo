/**
 * A failure whose words are a translation key rather than a sentence.
 *
 * Thrown by code that fails on the client's own account, an export with nothing to draw or a canvas
 * the browser refused, and read wherever a failure is put in front of the reader. The key travels
 * instead of English, so the toast can say it in the reader's language.
 */
export class KeyedError extends Error {
  readonly ns: string
  readonly key: string

  constructor(ns: string, key: string) {
    super(`${ns}.${key}`)
    this.name = "KeyedError"
    this.ns = ns
    this.key = key
  }
}
