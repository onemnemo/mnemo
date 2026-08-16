/**
 * A pure, synchronous content hash for the generated document. `crypto.subtle.digest` is
 * async and the Web Crypto `crypto` global is not guaranteed present in every harness context
 * (a worker without it, a locked-down webview), so a hand-rolled hash is the only option that
 * is guaranteed to exist and behave identically everywhere the spike runs.
 *
 * cyrb53 (Bryc's public-domain hash) is used rather than something cryptographic because
 * nothing here needs collision resistance against an adversary, only a cheap, well-distributed
 * fingerprint two independently built documents either match or do not. It is built entirely
 * from `Math.imul` and 32-bit bitwise ops, which the spec pins down exactly, so the digest is
 * identical on every engine the spike targets given the same input string.
 */
function cyrb53(input: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/**
 * A field separator that cannot appear inside any generated string field (ids, titles, code
 * source, LaTeX). Without a separator, `["ab", "c"]` and `["a", "bc"]` would hash identically,
 * which would let a real structural difference between two documents go undetected.
 */
const FIELD_SEP = '␟'
const RECORD_SEP = '␞'

function joinFields(fields: readonly (string | number | boolean | undefined)[]): string {
  return fields.map((f) => (f === undefined ? '∅' : String(f))).join(FIELD_SEP)
}

/**
 * Digest input for one element. `includePosition` is the only difference between the
 * cross-engine fixture digest (position included, since two engines must land on the exact
 * same layout) and the logical-document digest used to prove forest and dense-grid share a
 * document and differ only in where things sit.
 */
export interface DigestElement {
  readonly id: string
  readonly kind: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly pinned?: boolean
  readonly collapsed?: boolean
  readonly fill?: string
  readonly stroke?: string
  /** Pre-serialized so this module never needs to know every ElementContent shape. */
  readonly contentDigestField: string
}

export interface DigestEdge {
  readonly id: string
  readonly fromId: string
  readonly toId: string
  readonly kind: string
  readonly label?: string
  readonly routing?: string
  readonly lineStyle?: string
  readonly thickness?: number
  readonly color?: string
  readonly startCap?: string
  readonly endCap?: string
}

export interface DigestDocument {
  readonly elements: readonly DigestElement[]
  readonly edges: readonly DigestEdge[]
  readonly clusterRoots: readonly string[]
  readonly parentOf: Readonly<Record<string, string>>
}

function serializeElement(el: DigestElement, includePosition: boolean): string {
  const positional = includePosition ? joinFields([el.x, el.y]) : ''
  return joinFields([
    el.id,
    el.kind,
    positional,
    el.width,
    el.height,
    el.pinned,
    el.collapsed,
    el.fill,
    el.stroke,
    el.contentDigestField,
  ])
}

function serializeEdge(edge: DigestEdge): string {
  return joinFields([
    edge.id,
    edge.fromId,
    edge.toId,
    edge.kind,
    edge.label,
    edge.routing,
    edge.lineStyle,
    edge.thickness,
    edge.color,
    edge.startCap,
    edge.endCap,
  ])
}

function serializeDocument(doc: DigestDocument, includePosition: boolean): string {
  const elementsPart = doc.elements.map((e) => serializeElement(e, includePosition)).join(RECORD_SEP)
  const edgesPart = doc.edges.map(serializeEdge).join(RECORD_SEP)
  const rootsPart = doc.clusterRoots.join(RECORD_SEP)
  const parentPart = Object.keys(doc.parentOf)
    .sort()
    .map((childId) => joinFields([childId, doc.parentOf[childId]]))
    .join(RECORD_SEP)
  return [elementsPart, edgesPart, rootsPart, parentPart].join('\n===\n')
}

/** The fixture digest: ids, kinds, positions, sizes, content and edges, everything included. */
export function computeDigest(doc: DigestDocument): string {
  return cyrb53(serializeDocument(doc, true), 0)
}

/**
 * The same document with x/y left out. Used to prove FOREST and DENSE-GRID are the same
 * logical document differing only in where things are positioned, which is the whole point
 * of generating two layouts from one build rather than two unrelated documents.
 */
export function computeContentDigest(doc: DigestDocument): string {
  return cyrb53(serializeDocument(doc, false), 0)
}
