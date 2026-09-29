/**
 * The file behind a picture dragged out of a web page.
 *
 * Fetched by the app itself, so the address is held to what a page could fairly hand over: https or
 * a data URI, never a host on this machine or its network, read up to the upload cap and no further,
 * and kept only when its first bytes say it is a picture the map can store.
 */

import { MAX_IMAGE_BYTES } from "@/components/ui/image-editor/source"

/** How long a page's server gets before the drop gives up on it. */
const FETCH_TIMEOUT_MS = 15_000

/** Under this, a data URI is a tracking pixel or a lazy-load stand-in rather than the picture. */
const PLACEHOLDER_BYTES = 64

/** Whether a drag over the map may carry a picture, read from the types alone as dragover allows. */
export function mayCarryImage(types: readonly string[]): boolean {
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html")
}

/**
 * The address of a picture dragged out of a web page, or null when the drag carries none.
 *
 * The page's own `<img src>` first, since a picture inside a link carries the link's page as its URI.
 * A stand-in image is passed over for the URI, which is where a lazy-loading page keeps the real one.
 */
export function imageUrlOf(data: Pick<DataTransfer, "getData">): string | null {
  const html = data.getData("text/html")
  const src = html
    ? (new DOMParser().parseFromString(html, "text/html").querySelector("img[src]")?.getAttribute("src")?.trim() ?? null)
    : null
  const listed =
    data
      .getData("text/uri-list")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("#")) ?? null

  if (src && !isPlaceholderDataUri(src)) {
    return src
  }
  return listed ?? src
}

/** A data URI too small to be a real picture: a few dozen bytes, or two pixels a side or less. */
export function isPlaceholderDataUri(url: string): boolean {
  const bytes = dataUriBytes(url)
  if (!bytes) {
    return false
  }
  if (bytes.length < PLACEHOLDER_BYTES) {
    return true
  }
  const size = pixelSize(bytes)
  return size !== null && size[0] <= 2 && size[1] <= 2
}

function dataUriBytes(url: string): Uint8Array | null {
  const match = /^data:[^,]*?(;base64)?,(.*)$/is.exec(url)
  if (!match) {
    return null
  }
  try {
    const text = match[1] ? atob(match[2]) : decodeURIComponent(match[2])
    return Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff)
  } catch {
    return null
  }
}

/** Width and height from a PNG or GIF header, or null for anything else. */
function pixelSize(bytes: Uint8Array): [number, number] | null {
  if (sniffImageType(bytes) === "image/png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset)
    return [view.getUint32(16), view.getUint32(20)]
  }
  if (sniffImageType(bytes) === "image/gif" && bytes.length >= 10) {
    const view = new DataView(bytes.buffer, bytes.byteOffset)
    return [view.getUint16(6, true), view.getUint16(8, true)]
  }
  return null
}

/** The type a file's first bytes declare, among the ones the map stores, or null. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png"
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg"
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif"
  if (starts(0x42, 0x4d)) return "image/bmp"
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp"
  }
  return null
}

/**
 * Whether the app may fetch this address for a drop: https to a public host, or a data URI. A name
 * with no dot, an address on this machine and a private or link-local one are all refused.
 */
export function isFetchableImageUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === "data:") {
    return /^data:image\//i.test(url)
  }
  if (parsed.protocol !== "https:") {
    return false
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost")) {
    return false
  }
  if (host.includes(":")) {
    return isPublicIpv6(host)
  }
  const ipv4 = parseIpv4(host)
  if (ipv4) {
    return isPublicIpv4(ipv4)
  }
  return host.includes(".") && !host.endsWith(".")
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".")
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) {
    return null
  }
  const octets = parts.map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

function isPublicIpv4([a, b]: number[]): boolean {
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

function isPublicIpv6(host: string): boolean {
  if (host === "::" || host === "::1") {
    return false
  }
  // An IPv4 address carried inside IPv6 is judged as the IPv4 address it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)?.[1] ?? hexMappedIpv4(host)
  if (mapped) {
    const ipv4 = parseIpv4(mapped)
    return ipv4 !== null && isPublicIpv4(ipv4)
  }
  const first = parseInt(host.split(":")[0] || "0", 16)
  // Unique local (fc00::/7) and link-local (fe80::/10).
  return !((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80)
}

/** The URL parser writes `::ffff:127.0.0.1` as `::ffff:7f00:1`. */
function hexMappedIpv4(host: string): string | null {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (!match) {
    return null
  }
  const high = parseInt(match[1], 16)
  const low = parseInt(match[2], 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

/**
 * The picture behind an address, as a file the store will take. Rejects an address the app may not
 * fetch, a server that does not answer in time or allow the read, anything over the upload cap, and
 * bytes that are not a stored image type whatever their label says.
 */
export async function fileFromImageUrl(url: string, fallbackName: string): Promise<File> {
  if (!isFetchableImageUrl(url)) {
    throw new Error("The address is not one the map fetches pictures from.")
  }
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`The picture could not be fetched (${response.status}).`)
  }
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new Error("The picture is larger than the upload limit.")
  }
  const bytes = await readCapped(response, MAX_IMAGE_BYTES)
  const type = sniffImageType(bytes)
  if (!type) {
    throw new Error("The address is not a picture the map can hold.")
  }
  return new File([bytes], nameOf(url) ?? fallbackName, { type })
}

async function readCapped(response: Response, cap: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader()
  if (!reader) {
    const whole = new Uint8Array(await response.arrayBuffer())
    if (whole.length > cap) {
      throw new Error("The picture is larger than the upload limit.")
    }
    return whole
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.length
    if (total > cap) {
      await reader.cancel()
      throw new Error("The picture is larger than the upload limit.")
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function nameOf(url: string): string | null {
  if (url.startsWith("data:")) {
    return null
  }
  try {
    const last = new URL(url).pathname.split("/").pop()
    return last ? decodeURIComponent(last) : null
  } catch {
    return null
  }
}
