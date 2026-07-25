import { describe, expect, it } from "vitest"

import { DEFAULT_PDF_OPTIONS, toRequestBody, type PdfOptions } from "./options"

describe("toRequestBody", () => {
  it("maps the defaults to the tokens and font size the server expects", () => {
    expect(toRequestBody(DEFAULT_PDF_OPTIONS)).toEqual({
      paper: "a4",
      margin: "normal",
      includeNoteTitle: true,
      baseFontSizePt: 11,
      pageNumberAlignment: "center",
      pageNumberFormat: "currentAndTotal",
      renderColors: true,
      renderImages: true,
    })
  })

  it("translates each font size choice to points", () => {
    const pt = (fontSize: PdfOptions["fontSize"]) =>
      toRequestBody({ ...DEFAULT_PDF_OPTIONS, fontSize }).baseFontSizePt
    expect(pt("small")).toBe(10)
    expect(pt("medium")).toBe(11)
    expect(pt("large")).toBe(12)
    expect(pt("xlarge")).toBe(14)
  })

  it("passes the position and boolean toggles straight through", () => {
    const body = toRequestBody({
      ...DEFAULT_PDF_OPTIONS,
      paper: "letter",
      margin: "narrow",
      pageNumberPosition: "right",
      pageNumberFormat: "current",
      includeTitle: false,
      renderColors: false,
      renderImages: false,
    })
    expect(body).toMatchObject({
      paper: "letter",
      margin: "narrow",
      pageNumberAlignment: "right",
      pageNumberFormat: "current",
      includeNoteTitle: false,
      renderColors: false,
      renderImages: false,
    })
  })
})
