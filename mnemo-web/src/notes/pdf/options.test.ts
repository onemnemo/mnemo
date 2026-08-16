import { describe, expect, it } from "vitest"

import {
  DEFAULT_PDF_OPTIONS,
  pageNumberSample,
  sanitizeFileStem,
  toRequestBody,
  type PdfOptions,
} from "./options"

const TEXT = { wordedPageNumber: "Page {0} of {1}", missingSubpageTitle: "Untitled" }

describe("toRequestBody", () => {
  it("maps the defaults to the tokens and font size the server expects", () => {
    expect(toRequestBody(DEFAULT_PDF_OPTIONS, TEXT)).toEqual({
      paper: "a4",
      landscape: false,
      margin: "normal",
      includeNoteTitle: true,
      includeTags: true,
      baseFontSizePt: 11,
      pageNumberAlignment: "center",
      pageNumberFormat: "currentAndTotal",
      pageNumberWordedFormat: "Page {0} of {1}",
      renderColors: true,
      renderImages: true,
      renderSubpageLinks: true,
      missingSubpageTitle: "Untitled",
    })
  })

  it("translates each font size choice to points", () => {
    const pt = (fontSize: PdfOptions["fontSize"]) =>
      toRequestBody({ ...DEFAULT_PDF_OPTIONS, fontSize }, TEXT).baseFontSizePt
    expect(pt("small")).toBe(10)
    expect(pt("medium")).toBe(11)
    expect(pt("large")).toBe(12)
    expect(pt("xlarge")).toBe(14)
  })

  it("passes the page setup and toggles straight through", () => {
    const body = toRequestBody(
      {
        ...DEFAULT_PDF_OPTIONS,
        paper: "legal",
        landscape: true,
        margin: "wide",
        pageNumbers: "right",
        pageNumberStyle: "worded",
        includeTitle: false,
        includeTags: false,
        renderColors: false,
        renderImages: false,
        renderSubpages: false,
      },
      { wordedPageNumber: "Side {0} av {1}", missingSubpageTitle: "Uten tittel" },
    )
    expect(body).toMatchObject({
      paper: "legal",
      landscape: true,
      margin: "wide",
      pageNumberAlignment: "right",
      pageNumberFormat: "worded",
      pageNumberWordedFormat: "Side {0} av {1}",
      includeNoteTitle: false,
      includeTags: false,
      renderColors: false,
      renderImages: false,
      renderSubpageLinks: false,
      missingSubpageTitle: "Uten tittel",
    })
  })
})

describe("pageNumberSample", () => {
  it("shows each style with the numbers of the page being looked at", () => {
    expect(pageNumberSample("current", 2, 7, "Page {0} of {1}")).toBe("2")
    expect(pageNumberSample("currentAndTotal", 2, 7, "Page {0} of {1}")).toBe("2 / 7")
    expect(pageNumberSample("worded", 2, 7, "Side {0} av {1}")).toBe("Side 2 av 7")
  })
})

describe("sanitizeFileStem", () => {
  it("drops the characters no filesystem accepts and keeps the rest", () => {
    expect(sanitizeFileStem('Week 3: notes/drafts <v2>')).toBe("Week 3 notesdrafts v2")
  })
})
