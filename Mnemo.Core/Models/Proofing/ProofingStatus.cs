using System.Collections.Generic;

namespace Mnemo.Core.Models.Proofing;

/// <summary>The licence a dictionary is redistributed under, and where to read it.</summary>
public sealed record ProofingLicense(string Name, string Url);

/// <summary>How ready a language is to answer a check.</summary>
public static class ProofingLanguageState
{
    /// <summary>Loaded, and a check for it answers immediately.</summary>
    public const string Ready = "ready";

    /// <summary>Installed, but the word list is still being read.</summary>
    public const string Loading = "loading";

    /// <summary>No files for this language, so it cannot be checked at all.</summary>
    public const string Absent = "absent";
}

/// <summary>One language the settings surface lists, whether or not it can be used.</summary>
/// <param name="State">One of the constants on <see cref="ProofingLanguageState"/>.</param>
/// <param name="ReasonKey">Translation key explaining an absence. Null when the language is usable.</param>
public sealed record ProofingLanguageStatus(
    string Id,
    string Name,
    string Region,
    bool Installed,
    bool Bundled,
    string State,
    string? ReasonKey,
    ProofingLicense License);

/// <summary>
/// Everything a client needs to decide whether to proof, and in which languages.
/// </summary>
/// <param name="Active">
/// The ordered set of languages the host will use, first one suggesting first, and empty when the
/// user has switched them all off. Resolved here rather than read from settings by the client,
/// because a profile that has never chosen falls back through an older single choice, the older
/// editor setting and a bundled default, and only the host can see all three.
/// </param>
/// <param name="Note">
/// What the note that was asked about is checked in, or null when no note was named.
/// </param>
public sealed record ProofingStatus(
    bool Enabled,
    IReadOnlyList<string> Active,
    IReadOnlyList<ProofingLanguageStatus> Languages,
    int PersonalWordCount,
    NoteProofing? Note);
