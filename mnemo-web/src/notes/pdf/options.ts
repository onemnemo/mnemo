/** The PDF render options the dialog edits, in the web layer's own vocabulary. */
export interface PdfOptions {
  paper: PaperId
  /** Turns the sheet on its side; the paper keeps its size. */
  landscape: boolean
  margin: MarginId
  fontSize: FontSizeId
  /** Where the page number sits, and whether there is one at all: the same decision. */
  pageNumbers: "none" | "left" | "center" | "right"
  pageNumberStyle: "current" | "currentAndTotal" | "worded"
  includeTitle: boolean
  includeTags: boolean
  renderColors: boolean
  renderImages: boolean
  renderSubpages: boolean
}

export type PaperId = "a4" | "letter" | "legal" | "a5"
export type MarginId = "narrow" | "normal" | "wide"
export type FontSizeId = "small" | "medium" | "large" | "xlarge"

/** Millimetres, so the margin row can state the figure the preset actually means. */
export const MARGIN_MM: Record<MarginId, number> = {
  narrow: 12.7,
  normal: 20,
  wide: 31.8,
}

export const FONT_SIZE_PT: Record<FontSizeId, number> = {
  small: 10,
  medium: 11,
  large: 12,
  xlarge: 14,
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  paper: "a4",
  landscape: false,
  margin: "normal",
  fontSize: "medium",
  pageNumbers: "center",
  pageNumberStyle: "currentAndTotal",
  includeTitle: true,
  includeTags: true,
  renderColors: true,
  renderImages: true,
  renderSubpages: true,
}

/**
 * The strings the server prints into the document. They come from the caller's own bundle rather
 * than from the server so the footer follows the reader's language.
 */
export interface PdfDocumentText {
  /** The worded page number, with `{0}` for the page and `{1}` for the total. */
  wordedPageNumber: string
  /** Stands in for a sub-page whose note could not be read. */
  missingSubpageTitle: string
}

/**
 * The request body for the export/preview endpoints. The server takes lenient string tokens and
 * clamps the font size, so this only has to name the choice; unknown tokens fall back server-side.
 */
export interface PdfRequestBody {
  paper: string
  landscape: boolean
  margin: string
  includeNoteTitle: boolean
  includeTags: boolean
  baseFontSizePt: number
  pageNumberAlignment: string
  pageNumberFormat: string
  pageNumberWordedFormat: string
  renderColors: boolean
  renderImages: boolean
  renderSubpageLinks: boolean
  missingSubpageTitle: string
}

export function toRequestBody(options: PdfOptions, text: PdfDocumentText): PdfRequestBody {
  return {
    paper: options.paper,
    landscape: options.landscape,
    margin: options.margin,
    includeNoteTitle: options.includeTitle,
    includeTags: options.includeTags,
    baseFontSizePt: FONT_SIZE_PT[options.fontSize],
    pageNumberAlignment: options.pageNumbers,
    pageNumberFormat: options.pageNumberStyle,
    pageNumberWordedFormat: text.wordedPageNumber,
    renderColors: options.renderColors,
    renderImages: options.renderImages,
    renderSubpageLinks: options.renderSubpages,
    missingSubpageTitle: text.missingSubpageTitle,
  }
}

/**
 * How a page number reads under each style, used to label the style choices with the numbers of
 * the page being looked at. An option that shows itself beats an option that names itself.
 */
export function pageNumberSample(
  style: PdfOptions["pageNumberStyle"],
  page: number,
  total: number,
  worded: string,
): string {
  if (style === "current") return String(page)
  if (style === "currentAndTotal") return `${String(page)} / ${String(total)}`
  return worded.replace("{0}", String(page)).replace("{1}", String(total))
}

/** Strips the characters no filesystem accepts, so the name in the field is the name on disk. */
export function sanitizeFileStem(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "")
}
