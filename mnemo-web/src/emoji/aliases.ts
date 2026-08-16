/**
 * Search terms the emoji dataset does not carry.
 *
 * The dataset names an emoji by what it depicts, and emojilib adds everyday
 * synonyms, so between them "anatomical heart" and "cardiology" both find 🫀. What
 * neither covers is the vocabulary a student actually types: subject names,
 * disciplines and course words. Those live here.
 *
 * Written term first because that is how you think of them when adding one. The
 * dataset inverts it into per-emoji keywords when it builds.
 */
export const EMOJI_ALIASES: Record<string, readonly string[]> = {
  // Sciences
  physics: ["⚛️", "🧲", "🔭", "🚀", "⚡"],
  chemistry: ["🧪", "⚗️", "🧫", "⚛️"],
  biology: ["🧬", "🦠", "🌱", "🔬", "🧫"],
  astronomy: ["🔭", "🪐", "☄️", "🌍", "🚀"],
  geology: ["🪨", "🌋", "⛏️", "🗺️"],
  ecology: ["🌱", "🍃", "🌍", "🦠"],
  genetics: ["🧬", "🔬"],
  microbiology: ["🦠", "🔬", "🧫"],

  // Medicine
  anatomy: ["🫀", "🫁", "🧠", "🦴", "🦷", "🩻"],
  cardiology: ["🫀", "🩺"],
  neurology: ["🧠"],
  pharmacology: ["💊", "💉"],
  pathology: ["🦠", "🔬", "🩸"],
  radiology: ["🩻"],
  surgery: ["🏥", "🩹", "🧑‍⚕️"],
  nursing: ["🩺", "🏥", "👩‍⚕️"],
  dentistry: ["🦷"],
  immunology: ["🦠", "💉"],

  // Maths and computing
  mathematics: ["📐", "📏", "🧮", "➗"],
  maths: ["📐", "🧮", "➗"],
  math: ["📐", "🧮", "➗"],
  algebra: ["📐", "🧮"],
  geometry: ["📐", "📏"],
  calculus: ["📐", "🧮"],
  statistics: ["📊", "📈", "📉"],
  programming: ["💻", "⌨️", "🤖"],
  computing: ["💻", "🖥️", "⌨️"],
  algorithms: ["💻", "🧠"],

  // Engineering
  engineering: ["⚙️", "🔧", "🛠️", "🔩", "🏗️"],
  mechanics: ["⚙️", "🔧", "🔩"],
  electronics: ["🔌", "🔋", "⚡", "💻"],
  robotics: ["🤖", "⚙️"],
  architecture: ["🏗️", "📐", "🏛️"],
  aerospace: ["🚀", "🛰️", "✈️"],

  // Humanities and languages
  history: ["📜", "🏛️", "⏳"],
  geography: ["🗺️", "🌍", "🧭"],
  philosophy: ["🤔", "📜", "🏛️"],
  literature: ["📖", "📚", "✍️"],
  grammar: ["🔤", "✍️", "📖"],
  vocabulary: ["🔤", "📖", "💬"],
  linguistics: ["🗣️", "🔤", "🌐"],
  translation: ["🌐", "💬", "🔤"],
  law: ["⚖️", "📜"],
  economics: ["📈", "💰", "📊"],
  music: ["🎵", "🎼", "🎹"],
  art: ["🎨", "🖌️"],

  // Study habits
  revision: ["📚", "🔁", "📝"],
  exam: ["📝", "⏰", "🎓"],
  homework: ["📝", "📒"],
  lecture: ["🏫", "🗣️", "📖"],
  deadline: ["⏰", "📌"],
}
