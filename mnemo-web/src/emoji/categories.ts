/**
 * Mnemo's own way of grouping emoji, which is not the Unicode one.
 *
 * The dataset ships nine groups built for a general keyboard ("Smileys & Emotion",
 * "Food & Drink"). Someone naming a deck wants the subject they study, so the
 * study categories come first and are curated by hand, and the Unicode groups fold
 * into the broad ones underneath. Membership is many to many: a curated emoji
 * keeps whatever category its Unicode group maps to as well, so 🧬 is reachable
 * under both Science and Medicine.
 */

export const EMOJI_CATEGORIES = [
  "recent",
  "study",
  "science",
  "medicine",
  "languages",
  "engineering",
  "people",
  "nature",
  "objects",
  "symbols",
] as const

export type EmojiCategoryId = (typeof EMOJI_CATEGORIES)[number]

/** Translation keys, kept beside the ids so a new category cannot forget its label. */
export const EMOJI_CATEGORY_KEY: Record<EmojiCategoryId, string> = {
  recent: "CategoryRecent",
  study: "CategoryStudy",
  science: "CategoryScience",
  medicine: "CategoryMedicine",
  languages: "CategoryLanguages",
  engineering: "CategoryEngineering",
  people: "CategoryPeople",
  nature: "CategoryNature",
  objects: "CategoryObjects",
  symbols: "CategorySymbols",
}

/**
 * Filled at runtime from what the user has picked, so it has no members here and
 * the dataset never assigns it.
 */
export const RECENT_CATEGORY: EmojiCategoryId = "recent"

/**
 * Every Unicode group maps somewhere, so the picker can reach all 1900-odd emoji
 * rather than only the curated ones. Flags sit with Symbols because that is where
 * someone hunting a language marker looks after the curated Languages set.
 */
export const UNICODE_GROUP_CATEGORY: Record<string, EmojiCategoryId> = {
  "Smileys & Emotion": "people",
  "People & Body": "people",
  "Animals & Nature": "nature",
  "Food & Drink": "nature",
  "Travel & Places": "objects",
  Activities: "objects",
  Objects: "objects",
  Symbols: "symbols",
  Flags: "symbols",
}

/**
 * The hand-picked members of the study categories, in the order they should read.
 *
 * These are presentation-form characters: the dataset keys "⚙️" (with U+FE0F) and
 * not "⚙", and a bare form silently matches nothing. A test asserts every entry
 * here resolves, because the two forms are indistinguishable on screen.
 */
export const CURATED_CATEGORIES: Partial<Record<EmojiCategoryId, readonly string[]>> = {
  study: [
    "📕", "📗", "📘", "📙", "📓", "📚", "📝", "✏️", "📌", "🔖", "🗂️", "📐",
    "🧮", "🎓", "⏱️", "📖", "🖊️", "📒", "📔", "📄", "📋", "📏", "🏫", "🧑‍🎓",
    "🧠", "💡", "🗒️", "⏰", "✅", "🔍",
  ],
  science: [
    "🧬", "🧪", "🔬", "🔭", "⚗️", "🧲", "⚛️", "🪐", "🌍", "🌡️", "💡", "⚙️",
    "🖥️", "🧠", "🦠", "🧫", "🌎", "🌏", "☄️", "💧", "🔥", "❄️", "🌱", "⚡",
  ],
  medicine: [
    "💊", "🩺", "🫀", "🫁", "🦴", "🩻", "💉", "🧫", "🩹", "🚑", "🥼", "🦷",
    "👁️", "🧑‍⚕️", "🏥", "🧠", "🧬", "🦠", "🩸", "😷", "🤒", "⚕️", "👩‍⚕️", "👨‍⚕️",
  ],
  languages: [
    "🇩🇪", "🇫🇷", "🇪🇸", "🇮🇹", "🇯🇵", "🇰🇷", "🇨🇳", "🇸🇪", "🇩🇰", "🇳🇴", "💬", "🗣️",
    "🔤", "📖", "🌐", "🔡", "🔠", "📢", "🗨️", "✍️", "📜", "🈯", "🈳", "🅰️", "💭",
  ],
  engineering: [
    "⚙️", "🔧", "🔨", "🛠️", "🪛", "🔩", "⚡", "🔌", "💻", "🖥️", "⌨️", "🖱️",
    "🤖", "🏗️", "🚀", "🛰️", "📡", "🧰", "⛏️", "🔋", "🧱",
  ],
}
