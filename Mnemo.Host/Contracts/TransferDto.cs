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
/// <param name="Evidence">
/// What importing this file would mean, for a format that can work it out before writing anything.
/// Null for every format that reads no manifest, which is all of them but the package.
/// </param>
public sealed record TransferUploadDto(
    string UploadId,
    string FileName,
    long SizeBytes,
    string FormatId,
    string FormatName,
    bool CanImport,
    int? CardCount,
    IReadOnlyList<TransferWarningDto> Warnings,
    PackageEvidenceDto? Evidence = null);

/// <summary>
/// What opening a package would mean. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C#
/// side is authoritative.
/// </summary>
/// <param name="FromThisCollection">
/// Whether the package was written by this installation. It informs the reader, it never decides
/// anything on its own: a package from elsewhere is not wrong, and one from here is not safe.
/// </param>
public sealed record PackageEvidenceDto(
    string Kind,
    string? CollectionId,
    bool FromThisCollection,
    DateTimeOffset? CreatedAtUtc,
    string? CreatedByAppVersion,
    bool CanRead,
    IReadOnlyList<PayloadEvidenceDto> Payloads)
{
    public static PackageEvidenceDto FromModel(MnemoPackageEvidence model) => new(
        model.Kind,
        model.CollectionId,
        model.FromThisCollection,
        model.CreatedAtUtc,
        model.CreatedByAppVersion,
        model.CanRead,
        model.Payloads.Select(PayloadEvidenceDto.FromModel).ToList());
}

/// <param name="ReplaceWouldDiscard">
/// User visible content a replace would destroy: what sits inside the items the package also
/// carries and that the package itself does not contain. For flashcards, a card count.
/// </param>
public sealed record PayloadEvidenceDto(
    string PayloadType,
    int PayloadVersion,
    int SupportedPayloadVersion,
    bool CanRead,
    int InPackage,
    int AlreadyHere,
    int NewHere,
    int MissingFromPackage,
    int ReplaceWouldDiscard)
{
    public static PayloadEvidenceDto FromModel(MnemoPayloadEvidence model) => new(
        model.PayloadType,
        model.PayloadVersion,
        model.SupportedPayloadVersion,
        model.CanRead,
        model.InPackage,
        model.AlreadyHere,
        model.NewHere,
        model.MissingFromPackage,
        model.ReplaceWouldDiscard);
}

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
/// <param name="Kind">
/// <c>backup</c> when the request covers the whole collection, <c>export</c> when it covers a
/// chosen part of it, null to let the adapter work it out. Both arrive here as a list of deck ids
/// and only the caller knows which one the user asked for.
/// </param>
public sealed record TransferExportDto(string FormatId, IReadOnlyList<string> DeckIds, string? Kind = null);
