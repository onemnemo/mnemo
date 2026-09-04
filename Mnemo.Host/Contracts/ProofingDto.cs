using System.Collections.Generic;

namespace Mnemo.Host.Contracts;

/// <summary>A licence name and where its text can be read.</summary>
public sealed record ProofingLicenseDto(string Name, string Url);

/// <summary>One language, whether or not this build can check it.</summary>
/// <param name="Name">The English name. The client prints it when its bundle has no entry for
/// <paramref name="NameKey"/>, so a dictionary added after a translation pass still reads as a word.</param>
/// <param name="NameKey">Translation key naming the language.</param>
/// <param name="RegionKey">Translation key naming the region, null when the language names none.</param>
/// <param name="State"><c>ready</c>, <c>loading</c> or <c>absent</c>.</param>
/// <param name="ReasonKey">Translation key explaining an absence. Serialised as null when there is none.</param>
public sealed record ProofingLanguageDto(
    string Id,
    string Name,
    string NameKey,
    string Region,
    string? RegionKey,
    bool Installed,
    bool Bundled,
    string State,
    string? ReasonKey,
    ProofingLicenseDto License);

/// <summary>What one note is checked in. <paramref name="Mode"/> is <c>default</c>, <c>custom</c> or <c>off</c>.</summary>
public sealed record NoteProofingDto(
    string Mode,
    IReadOnlyList<string> Languages,
    IReadOnlyList<string> Effective);

/// <summary>
/// What the client needs before it starts proofing. <paramref name="Active"/> is the ordered set of
/// languages the host resolved, and is the only place the client should read it from.
/// <paramref name="Note"/> is null unless the request named a note.
/// </summary>
public sealed record ProofingStatusDto(
    bool Enabled,
    IReadOnlyList<string> Active,
    IReadOnlyList<ProofingLanguageDto> Languages,
    int PersonalWordCount,
    NoteProofingDto? Note);

/// <summary>One unit of text to check, identified by whatever key the client wants back.</summary>
public sealed record ProofingParagraphDto(string? Id, string? Text);

/// <summary>
/// A batch of paragraphs, optionally attributed to a note so its own languages and ignore list
/// apply. <paramref name="Languages"/> may only narrow what the note or the settings resolve to; a
/// list holding anything outside that set is ignored.
/// </summary>
public sealed record ProofingCheckRequestDto(
    IReadOnlyList<string>? Languages,
    string? NoteId,
    IReadOnlyList<ProofingParagraphDto>? Paragraphs);

/// <summary>A replacement the client can apply over an issue's range.</summary>
public sealed record ProofingFixDto(string Replacement, string? Label);

/// <summary>
/// One issue. <paramref name="Start"/> and <paramref name="End"/> are UTF-16 code unit offsets into
/// the paragraph text that was sent, with <paramref name="End"/> exclusive, so they index a
/// JavaScript string directly.
/// </summary>
public sealed record ProofingIssueDto(
    int Start,
    int End,
    string Text,
    string Kind,
    string Tone,
    string? RuleId,
    string? TitleKey,
    string? MessageKey,
    IReadOnlyList<ProofingFixDto>? Fixes);

/// <summary>The issues found in one paragraph, echoing the id it was sent with.</summary>
public sealed record ProofingParagraphResultDto(string Id, IReadOnlyList<ProofingIssueDto> Issues);

/// <summary>
/// The answer to a batch. <paramref name="Languages"/> are the ones actually used, in order, so a
/// client can drop an answer that arrived after the languages changed.
/// </summary>
public sealed record ProofingCheckResponseDto(
    IReadOnlyList<string> Languages,
    IReadOnlyList<ProofingParagraphResultDto> Paragraphs);

/// <summary>A request for replacements over one range of one text.</summary>
public sealed record ProofingSuggestRequestDto(
    IReadOnlyList<string>? Languages,
    string? NoteId,
    string? Text,
    int Start,
    int End,
    string? RuleId);

/// <summary>Replacements, best first, at most eight.</summary>
public sealed record ProofingSuggestResponseDto(IReadOnlyList<ProofingFixDto> Suggestions);

/// <summary>One stored personal word.</summary>
public sealed record ProofingPersonalWordDto(string Word, string? Language, string AddedAt);

/// <summary>
/// The whole personal dictionary. <paramref name="Outcome"/> is set by an addition alone, so the
/// caller can tell a word that was stored from one that was already there without comparing counts.
/// </summary>
public sealed record ProofingPersonalWordsDto(IReadOnlyList<ProofingPersonalWordDto> Words, string? Outcome = null);

/// <summary>A word to add to, or remove from, the personal dictionary.</summary>
public sealed record ProofingPersonalWordRequestDto(string? Word, string? Language);

/// <summary>The words one note ignores.</summary>
public sealed record ProofingNoteIgnoresDto(IReadOnlyList<string> Words);

/// <summary>A word to add to, or remove from, one note's ignore list.</summary>
public sealed record ProofingNoteIgnoreRequestDto(string? Word);

/// <summary>
/// What one note should be checked in. <paramref name="Mode"/> is <c>default</c> to follow the
/// languages settings names, <c>custom</c> to use <paramref name="Languages"/>, or <c>off</c>.
/// </summary>
public sealed record ProofingNoteLanguagesRequestDto(string? Mode, IReadOnlyList<string>? Languages);
