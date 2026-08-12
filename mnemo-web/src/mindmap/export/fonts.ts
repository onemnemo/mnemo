/**
 * The app's faces, carried into the picture.
 *
 * Only the raster path needs this. An SVG handed to an `<img>` to be drawn onto a canvas is loaded as
 * an isolated document with no network of its own, so the page's fonts are not there: the boxes were
 * measured in Inter and the PNG would come out set in whatever the system falls back to, text wider
 * or narrower than the box built for it. Fonts embedded as data go with it.
 *
 * Read from the stylesheet rather than from a list here, so a face added to the app is a face an
 * export gets. Best effort throughout: a font that cannot be read is left out and the picture falls
 * back the way any document with a missing font does.
 */

const files = new Map<string, Promise<string | null>>()

/**
 * `@font-face` rules for the named families, with the font files inlined.
 *
 * Every matching face, not just the one a label happens to need. The subsets are split by script, so
 * dropping all but the first would set a Greek label in a fallback while the Latin one beside it came
 * out right.
 */
export async function inlineFonts(families: readonly string[]): Promise<string> {
  const wanted = new Set(families.map((family) => family.toLowerCase()))
  const rules: string[] = []

  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList
    try {
      list = sheet.cssRules
    } catch {
      // A stylesheet from another origin refuses to be read at all, which is not something to
      // recover from, only something to walk past.
      continue
    }

    for (const rule of Array.from(list)) {
      if (!isFontFace(rule)) {
        continue
      }
      const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim()
      if (!wanted.has(family.toLowerCase())) {
        continue
      }
      rules.push(rule.cssText)
    }
  }

  const inlined = await Promise.all(rules.map(embed))
  return inlined.filter((rule): rule is string => rule !== null).join("\n")
}

function isFontFace(rule: CSSRule): rule is CSSFontFaceRule {
  return rule.constructor.name === "CSSFontFaceRule" || rule.type === 5
}

const URL_IN_SRC = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/

/** One rule with its file turned into data, or nothing when the file could not be fetched. */
async function embed(cssText: string): Promise<string | null> {
  const match = URL_IN_SRC.exec(cssText)
  const href = match?.[1] ?? match?.[2] ?? match?.[3]
  if (!href) {
    return null
  }
  if (href.startsWith("data:")) {
    return cssText
  }

  const data = await fetchFont(href)
  return data === null ? null : cssText.replace(URL_IN_SRC, `url("${data}")`)
}

function fetchFont(href: string): Promise<string | null> {
  const known = files.get(href)
  if (known) {
    return known
  }

  const pending = read(href)
  files.set(href, pending)
  return pending
}

async function read(href: string): Promise<string | null> {
  try {
    const response = await fetch(href)
    if (!response.ok) {
      return null
    }
    const blob = await response.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
