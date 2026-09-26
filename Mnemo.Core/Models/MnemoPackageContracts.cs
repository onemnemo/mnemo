using System;
using System.Collections.Generic;
using Mnemo.Core.Enums;

namespace Mnemo.Core.Models;

/// <summary>
/// Well-known keys for <see cref="MnemoPackageExportOptions.PayloadOptions"/>. A key is read by the
/// payload that owns it and by any payload that has to narrow itself to the same selection.
/// </summary>
public static class MnemoPayloadOptionKeys
{
    /// <summary>
    /// The notes an export is limited to, as a collection of note ids. Absent means every note.
    /// </summary>
    public const string NoteIds = "notes.noteIds";
}

/// <summary>
/// The kinds of id an import can rename, as keys of <see cref="MnemoPayloadImportResult.RemappedIds"/>
/// and <see cref="MnemoPayloadImportContext.RemappedIds"/>.
/// </summary>
public static class MnemoIdKinds
{
    public const string Notes = "notes";
    public const string FlashcardDecks = "flashcards.decks";
    public const string FlashcardCards = "flashcards.cards";

    /// <summary>The renames of <paramref name="kind"/>, or an empty table when none were made.</summary>
    public static IReadOnlyDictionary<string, string> Of(
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> remapped, string kind) =>
        remapped.TryGetValue(kind, out var ids) ? ids : Empty;

    private static readonly IReadOnlyDictionary<string, string> Empty = new Dictionary<string, string>();
}

public sealed class MnemoPackageExportOptions
{
    public IReadOnlyCollection<string>? PayloadTypes { get; set; }

    public string? PackageKind { get; set; }

    /// <summary>
    /// What the package is for: <c>backup</c> or <c>export</c>. See <see cref="MnemoPackageKinds"/>.
    /// A backup carries everything a handler can restore; an export carries the chosen part.
    /// </summary>
    public string Kind { get; set; } = MnemoPackageKinds.Export;

    public string? AppVersion { get; set; }

    public Dictionary<string, object?> PayloadOptions { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class MnemoPackageImportOptions
{
    public bool PreviewOnly { get; set; }

    public ImportConflictPolicy ConflictPolicy { get; set; } = ImportConflictPolicy.KeepBoth;

    public bool StrictUnknownPayloads { get; set; }

    public IReadOnlyCollection<string>? PayloadTypes { get; set; }

    public Dictionary<string, object?> PayloadOptions { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class MnemoPackageResult
{
    public bool Success { get; set; } = true;

    public MnemoPackageManifest? Manifest { get; set; }

    public Dictionary<string, int> ImportedCountsByPayload { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, int> DuplicatedCountsByPayload { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, int> SkippedCountsByPayload { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public List<TransferWarning> Warnings { get; set; } = new();

    public string? ErrorMessage { get; set; }
}

public sealed class MnemoPayloadExportData
{
    public int ItemCount { get; set; }

    public int SchemaVersion { get; set; } = 1;

    public Dictionary<string, byte[]> Files { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class MnemoPayloadImportResult
{
    public int ImportedCount { get; set; }

    public int DuplicatedCount { get; set; }

    public int SkippedCount { get; set; }

    /// <summary>
    /// Ids this payload had to change on the way in, by id kind (see <see cref="MnemoIdKinds"/>) and
    /// then from the id the package carried to the one now stored. Only the ones that moved; an id
    /// that is absent was stored as it arrived, and a kind with nothing moved has no entry.
    /// </summary>
    public Dictionary<string, Dictionary<string, string>> RemappedIds { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Records that <paramref name="from"/> of <paramref name="kind"/> was stored as <paramref name="to"/>. A no-op when they match.</summary>
    public void Remap(string kind, string from, string to)
    {
        if (string.Equals(from, to, StringComparison.Ordinal))
            return;
        if (!RemappedIds.TryGetValue(kind, out var ids))
            RemappedIds[kind] = ids = new Dictionary<string, string>(StringComparer.Ordinal);
        ids[from] = to;
    }

    public List<TransferWarning> Warnings { get; set; } = new();
}

public sealed class MnemoPayloadExportContext
{
    public required MnemoPackageExportOptions Options { get; init; }
}

public sealed class MnemoPayloadImportContext
{
    public required MnemoPackageEntry Entry { get; init; }

    public required MnemoPackageImportOptions Options { get; init; }

    public required IReadOnlyDictionary<string, byte[]> Files { get; init; }

    /// <summary>
    /// The manifest the payload arrived in, so a handler can tell a backup from an export. Defaults
    /// to a manifest declaring neither, which is what a package written before kinds existed says.
    /// </summary>
    public MnemoPackageManifest Manifest { get; init; } = new();

    /// <summary>
    /// What the payloads already imported from this package had to rename, by id kind (see
    /// <see cref="MnemoIdKinds"/>) and then by the id the package carried. A payload that refers to
    /// another payload's ids reads it from here so its references land on what was actually stored.
    /// Empty for any id that came through unchanged.
    /// </summary>
    /// <remarks>
    /// A payload sees the renames of the payload types it names in
    /// <see cref="Services.IMnemoPayloadHandler.ImportsAfter"/>, since those are imported before it.
    /// </remarks>
    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> RemappedIds { get; init; }
        = new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
}
