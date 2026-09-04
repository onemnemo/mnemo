/**
 * The proofing wire shapes.
 *
 * The unit of a check is a *segment*, not a block: a block's canonical text
 * folds an inline equation's LaTeX into the prose around it, and a block can
 * hold several segments, so one id per block cannot address an offset inside
 * the second one. `id` is `"<blockSid>:<segmentIndex>"`, offsets are UTF-16
 * code units local to that segment, and `end` is exclusive.
 *
 * `kind` is an open string and the issue carries a rule id, a title, a message
 * and fixes so a rule that is not a misspelling can be answered without a
 * second version of this endpoint. Spelling answers carry `kind: "spelling"`
 * and usually no fixes.
 */

export type ProofingTone = 'error' | 'unknown';

export type ProofingLanguageState = 'ready' | 'loading' | 'absent';

export interface ProofingLicense {
  readonly name: string;
  readonly url: string;
}

export interface ProofingLanguage {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly installed: boolean;
  readonly bundled: boolean;
  readonly state: ProofingLanguageState;
  readonly reasonKey?: string;
  readonly license: ProofingLicense;
}

export interface ProofingStatus {
  readonly enabled: boolean;
  /** The effective language, resolved by the host. The only source of truth for it. */
  readonly language: string;
  readonly languages: readonly ProofingLanguage[];
  readonly personalWordCount: number;
}

export interface ProofingFix {
  readonly label?: string;
  readonly replacement: string;
}

export interface ProofingIssue {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  readonly text: string;
  readonly kind: string;
  readonly tone: ProofingTone;
  readonly ruleId?: string;
  readonly titleKey?: string;
  readonly messageKey?: string;
  readonly fixes?: readonly ProofingFix[];
}

export interface ProofingParagraph {
  readonly id: string;
  readonly text: string;
}

export interface ProofingCheckRequest {
  readonly language: string;
  readonly noteId: string | null;
  readonly paragraphs: readonly ProofingParagraph[];
}

export interface ProofingParagraphAnswer {
  readonly id: string;
  readonly issues: readonly ProofingIssue[];
}

export interface ProofingCheckResponse {
  readonly language: string;
  readonly paragraphs: readonly ProofingParagraphAnswer[];
}

export interface ProofingSuggestRequest {
  readonly language: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly ruleId?: string;
}

export interface ProofingSuggestion {
  readonly replacement: string;
  readonly label?: string;
}

export interface ProofingSuggestResponse {
  readonly suggestions: readonly ProofingSuggestion[];
}

export interface PersonalWord {
  readonly word: string;
  readonly language: string | null;
  readonly addedAt: string;
}

export interface PersonalWords {
  readonly words: readonly PersonalWord[];
}

export interface NoteIgnores {
  readonly words: readonly string[];
}

/** The most segments and characters one check request may carry. */
export const MAX_PARAGRAPHS_PER_REQUEST = 200;
export const MAX_CHARACTERS_PER_REQUEST = 200_000;
