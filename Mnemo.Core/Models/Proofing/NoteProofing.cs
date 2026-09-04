using System.Collections.Generic;

namespace Mnemo.Core.Models.Proofing;

/// <summary>What a note has said about being checked.</summary>
public static class NoteProofingMode
{
    /// <summary>Checked in whatever languages settings names. Nothing is stored for the note.</summary>
    public const string Default = "default";

    /// <summary>Checked in the note's own list of languages.</summary>
    public const string Custom = "custom";

    /// <summary>Not checked at all.</summary>
    public const string Off = "off";
}

/// <summary>
/// One note's stored choice.
/// <para>
/// Only <see cref="NoteProofingMode.Custom"/> and <see cref="NoteProofingMode.Off"/> are ever
/// stored. A note that follows the defaults has no entry, so the absence is the third state and
/// nothing has to be written to go back to it.
/// </para>
/// </summary>
public sealed record NoteLanguageEntry(string Mode, IReadOnlyList<string> Languages);

/// <summary>What one note is checked in, resolved against the dictionaries this build carries.</summary>
/// <param name="Mode">One of the constants on <see cref="NoteProofingMode"/>.</param>
/// <param name="Languages">The note's own list, empty unless the mode is custom.</param>
/// <param name="Effective">
/// The languages a check will actually run in: the note's list filtered to installed dictionaries,
/// or the global active set when the note follows the defaults, or empty when it is off.
/// </param>
public sealed record NoteProofing(string Mode, IReadOnlyList<string> Languages, IReadOnlyList<string> Effective);
