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

/** Whether a note follows the active set, carries its own list, or is not checked. */
export type NoteProofingMode = 'default' | 'custom' | 'off';

export interface NoteProofing {
  readonly mode: NoteProofingMode;
  /** What the note stores. Empty in every mode but `custom`. */
  readonly languages: readonly string[];
  /** What the note is actually checked in, once the stored list meets what is installed. */
  readonly effective: readonly string[];
}

/** What a write to a note's languages says. `languages` is required by `custom` alone. */
export interface NoteProofingChoice {
  readonly mode: NoteProofingMode;
  readonly languages?: readonly string[];
}

export interface ProofingStatus {
  readonly enabled: boolean;
  /** The ordered active set, resolved by the host. The only source of truth for it. */
  readonly active: readonly string[];
  readonly languages: readonly ProofingLanguage[];
  readonly personalWordCount: number;
  /** Present only when a note was asked about. */
  readonly note?: NoteProofing | null;
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
  /** A word is correct when any of these knows it. The host may only narrow this list. */
  readonly languages: readonly string[];
  readonly noteId: string | null;
  readonly paragraphs: readonly ProofingParagraph[];
}

export interface ProofingParagraphAnswer {
  readonly id: string;
  readonly issues: readonly ProofingIssue[];
}

export interface ProofingCheckResponse {
  /** The set the host actually checked in, in order. */
  readonly languages: readonly string[];
  readonly paragraphs: readonly ProofingParagraphAnswer[];
}

export interface ProofingSuggestRequest {
  readonly languages: readonly string[];
  readonly noteId?: string | null;
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
  /**
   * Set by an addition alone, so a caller can tell a word that was stored from
   * one that was already there without comparing the list against its own idea
   * of what it held.
   */
  readonly outcome?: 'added' | 'alreadyPresent';
}

export interface NoteIgnores {
  readonly words: readonly string[];
}

/** The most segments and characters one check request may carry. */
export const MAX_PARAGRAPHS_PER_REQUEST = 200;
export const MAX_CHARACTERS_PER_REQUEST = 200_000;
