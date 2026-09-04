using System.Collections.Generic;

namespace Mnemo.Host.Contracts;

/// <summary>A licence name and where its text can be read.</summary>
public sealed record ProofingLicenseDto(string Name, string Url);

/// <summary>One language, whether or not this build can check it.</summary>
/// <param name="State"><c>ready</c>, <c>loading</c> or <c>absent</c>.</param>
/// <param name="ReasonKey">Translation key explaining an absence. Serialised as null when there is none.</param>
public sealed record ProofingLanguageDto(
    string Id,
    string Name,
    string Region,
    bool Installed,
    bool Bundled,
    string State,
    string? ReasonKey,
    ProofingLicenseDto License);

/// <summary>
/// What the client needs before it starts proofing. <paramref name="Language"/> is the effective
/// language the host resolved, and is the only place the client should read it from.
/// </summary>
public sealed record ProofingStatusDto(
    bool Enabled,
    string Language,
    IReadOnlyList<ProofingLanguageDto> Languages,
    int PersonalWordCount);

/// <summary>One unit of text to check, identified by whatever key the client wants back.</summary>
public sealed record ProofingParagraphDto(string? Id, string? Text);

/// <summary>A batch of paragraphs, optionally attributed to a note so its ignore list applies.</summary>
public sealed record ProofingCheckRequestDto(
    string? Language,
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
/// The answer to a batch. <paramref name="Language"/> is echoed so a client can drop an answer that
/// arrived after the user switched language.
/// </summary>
public sealed record ProofingCheckResponseDto(string Language, IReadOnlyList<ProofingParagraphResultDto> Paragraphs);

/// <summary>A request for replacements over one range of one text.</summary>
public sealed record ProofingSuggestRequestDto(
    string? Language,
    string? Text,
    int Start,
    int End,
    string? RuleId);

/// <summary>Replacements, best first, at most eight.</summary>
public sealed record ProofingSuggestResponseDto(IReadOnlyList<ProofingFixDto> Suggestions);

/// <summary>One stored personal word.</summary>
public sealed record ProofingPersonalWordDto(string Word, string? Language, string AddedAt);

/// <summary>The whole personal dictionary.</summary>
public sealed record ProofingPersonalWordsDto(IReadOnlyList<ProofingPersonalWordDto> Words);

/// <summary>A word to add to, or remove from, the personal dictionary.</summary>
public sealed record ProofingPersonalWordRequestDto(string? Word, string? Language);

/// <summary>The words one note ignores.</summary>
public sealed record ProofingNoteIgnoresDto(IReadOnlyList<string> Words);

/// <summary>A word to add to, or remove from, one note's ignore list.</summary>
public sealed record ProofingNoteIgnoreRequestDto(string? Word);
