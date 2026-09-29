// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fileFromImageUrl,
  imageUrlOf,
  isFetchableImageUrl,
  isPlaceholderDataUri,
  mayCarryImage,
  sniffImageType,
} from "./dropped-image"

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function transfer(data: Record<string, string>): Pick<DataTransfer, "getData"> {
  return { getData: (type: string) => data[type] ?? "" }
}

/** A PNG header claiming this size, padded out past the placeholder byte floor. */
function pngDataUri(width: number, height: number): string {
  const bytes = new Uint8Array(96)
  bytes.set(PNG_HEAD)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the address a page drag carries", () => {
  it("prefers the page's img over a link it sits inside", () => {
    const data = transfer({
      "text/html": '<a href="https://site.test/article"><img src="https://cdn.test/cat.png"></a>',
      "text/uri-list": "https://site.test/article",
    })
    expect(imageUrlOf(data)).toBe("https://cdn.test/cat.png")
  })

  it("passes over a stand-in pixel for the uri list", () => {
    const data = transfer({
      "text/html": `<img src="${pngDataUri(1, 1)}">`,
      "text/uri-list": "https://cdn.test/real.png",
    })
    expect(imageUrlOf(data)).toBe("https://cdn.test/real.png")
    expect(isPlaceholderDataUri("data:image/gif;base64,R0lGODlhAQABAAAAACw=")).toBe(true)
    expect(isPlaceholderDataUri(pngDataUri(64, 64))).toBe(false)
  })

  it("falls back to the first address in the uri list, skipping comments", () => {
    expect(imageUrlOf(transfer({ "text/uri-list": "# comment\r\nhttps://cdn.test/dog.jpg\r\n" }))).toBe(
      "https://cdn.test/dog.jpg",
    )
    expect(imageUrlOf(transfer({ "text/plain": "hello" }))).toBeNull()
  })

  it("claims a drag that carries files or a link, and nothing else", () => {
    expect(mayCarryImage(["Files"])).toBe(true)
    expect(mayCarryImage(["text/uri-list"])).toBe(true)
    expect(mayCarryImage(["text/plain"])).toBe(false)
  })
})

describe("which addresses the app fetches", () => {
  it("takes https to a public host and an image data URI", () => {
    expect(isFetchableImageUrl("https://cdn.test/cat.png")).toBe(true)
    expect(isFetchableImageUrl("https://93.184.216.34/cat.png")).toBe(true)
    expect(isFetchableImageUrl("data:image/png;base64,AAAA")).toBe(true)
  })

  it.each([
    "http://cdn.test/cat.png",
    "blob:https://site.test/1234",
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "https://localhost/a.png",
    "https://app.localhost/a.png",
    "https://intranet/a.png",
    "https://127.0.0.1/a.png",
    "https://10.1.2.3/a.png",
    "https://172.20.0.1/a.png",
    "https://192.168.1.1/a.png",
    "https://169.254.169.254/latest",
    "https://0.0.0.0/a.png",
    "https://[::1]/a.png",
    "https://[fe80::1]/a.png",
    "https://[fd00::1]/a.png",
    "https://[::ffff:127.0.0.1]/a.png",
  ])("refuses %s", (url) => {
    expect(isFetchableImageUrl(url)).toBe(false)
  })
})

describe("fetching a dropped picture", () => {
  it("names the type by its bytes, not by the label the server gave it", async () => {
    const bytes = new Uint8Array([...PNG_HEAD, 0, 0, 0, 0])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { headers: { "content-type": "text/plain" } })),
    )

    const file = await fileFromImageUrl("https://cdn.test/cat", "Image")

    expect(file.type).toBe("image/png")
    expect(file.name).toBe("cat")
  })

  it("refuses bytes that are not a stored picture type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", { headers: { "content-type": "image/png" } })))

    await expect(fileFromImageUrl("https://cdn.test/cat.png", "Image")).rejects.toThrow()
  })

  it("refuses a declared size over the upload cap before reading it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(PNG_HEAD), { headers: { "content-length": String(64 * 1024 * 1024) } })),
    )

    await expect(fileFromImageUrl("https://cdn.test/cat.png", "Image")).rejects.toThrow(/limit/)
  })

  it("never fetches an address it may not", async () => {
    const fetched = vi.fn()
    vi.stubGlobal("fetch", fetched)

    await expect(fileFromImageUrl("https://192.168.0.2/cat.png", "Image")).rejects.toThrow()
    expect(fetched).not.toHaveBeenCalled()
  })

  it("knows the stored types by their signatures", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBe("image/gif")
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp")
    expect(sniffImageType(new TextEncoder().encode("BM"))).toBe("image/bmp")
    expect(sniffImageType(new TextEncoder().encode("<svg"))).toBeNull()
  })
})
