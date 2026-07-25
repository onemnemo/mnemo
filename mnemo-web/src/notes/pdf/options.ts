/** The PDF render options the dialog edits, in the web layer's own vocabulary. */
export interface PdfOptions {
  paper: "a4" | "letter"
  margin: "normal" | "narrow"
  pageNumberPosition: "none" | "left" | "center" | "right"
  pageNumberFormat: "currentAndTotal" | "current"
  fontSize: "small" | "medium" | "large" | "xlarge"
  includeTitle: boolean
  renderColors: boolean
  renderImages: boolean
}

/** Matches the desktop overlay's defaults so both surfaces open on the same document. */
export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  paper: "a4",
  margin: "normal",
  pageNumberPosition: "center",
  pageNumberFormat: "currentAndTotal",
  fontSize: "medium",
  includeTitle: true,
  renderColors: true,
  renderImages: true,
}

const FONT_SIZE_PT: Record<PdfOptions["fontSize"], number> = {
  small: 10,
  medium: 11,
  large: 12,
  xlarge: 14,
}

/**
 * The request body for the export/preview endpoints. The server takes lenient string tokens and
 * clamps the font size, so this only has to name the choice; unknown tokens fall back server-side.
 */
export interface PdfRequestBody {
  paper: string
  margin: string
  includeNoteTitle: boolean
  baseFontSizePt: number
  pageNumberAlignment: string
  pageNumberFormat: string
  renderColors: boolean
  renderImages: boolean
}

export function toRequestBody(options: PdfOptions): PdfRequestBody {
  return {
    paper: options.paper,
    margin: options.margin,
    includeNoteTitle: options.includeTitle,
    baseFontSizePt: FONT_SIZE_PT[options.fontSize],
    pageNumberAlignment: options.pageNumberPosition,
    pageNumberFormat: options.pageNumberFormat,
    renderColors: options.renderColors,
    renderImages: options.renderImages,
  }
}
