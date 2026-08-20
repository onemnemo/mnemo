using Mnemo.Core.Models;

namespace Mnemo.Host.Contracts;

/// <summary>
/// One import/export format the app can handle. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
/// <param name="SupportsConflictPolicy">
/// Whether importing this format reads the conflict policy. False for formats whose files carry no
/// ids to collide on, so a client can stop offering a choice that would not be applied.
/// </param>
public sealed record TransferFormatDto(
    string FormatId,
    string DisplayName,
    IReadOnlyList<string> Extensions,
    bool SupportsImport,
    bool SupportsExport,
    bool SupportsConflictPolicy)
{
    public static TransferFormatDto FromModel(ImportExportCapability model)
        => new(
            model.FormatId,
            model.DisplayName,
            model.Extensions,
            model.SupportsImport,
            model.SupportsExport,
            model.SupportsConflictPolicy);
}

/// <summary>
/// A staged upload and what reading it turned up. The upload and its preview are one response
/// because the adapters can only preview a file that is already on disk, so splitting them would
/// mean a round trip that could tell the client nothing it did not already know.
/// </summary>
/// <param name="UploadId">Handle for the staged file, quoted back on import or discard.</param>
/// <param name="CardCount">
/// Cards the file is expected to yield, or null when its format's preview cannot be trusted to
/// say. Only the Anki adapter actually reads the file to answer; the others report a deck count
/// or a hardcoded 1 under the same name. Rather than print one of those beside the word "cards"
/// the way the desktop does, those rows show their size and format and no figure at all.
/// </param>
public sealed record TransferUploadDto(
    string UploadId,
    string FileName,
    long SizeBytes,
    string FormatId,
    string FormatName,
    bool CanImport,
    int? CardCount,
    IReadOnlyList<TransferWarningDto> Warnings);

/// <summary>
/// Import body. Several uploads run as one batch so the client reports a single outcome for what
/// the user experienced as one action.
/// </summary>
/// <param name="ConflictPolicy">
/// <c>KeepBoth</c> (default), <c>Skip</c> or <c>Replace</c>. Only the <c>.mnemo</c> format reads
/// it - CSV and Anki packages carry no ids to collide on, so every import of those is new content.
/// </param>
public sealed record TransferImportDto(IReadOnlyList<string> UploadIds, string? ConflictPolicy);

/// <summary>
/// What a batch import did. Per-file errors are collected rather than thrown so one unreadable
/// file in a batch of five does not discard the four that imported.
/// </summary>
/// <param name="ImportedCards">
/// Cards the library gained, measured across the batch rather than added up from what the
/// adapters reported: they do not agree on what they are counting, and a package that says "1"
/// meaning one deck would otherwise be announced as one card.
/// </param>
public sealed record TransferImportResultDto(
    int SucceededFiles,
    int FailedFiles,
    int ImportedCards,
    IReadOnlyList<TransferWarningDto> Warnings,
    IReadOnlyList<string> Errors);

/// <summary>
/// Export body. <paramref name="DeckIds"/> is always explicit, including for "everything visible":
/// the adapters read an empty selection as "export the whole library", which is not a thing any
/// caller here means.
/// </summary>
public sealed record TransferExportDto(string FormatId, IReadOnlyList<string> DeckIds);
