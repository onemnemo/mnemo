namespace Mnemo.Host.Contracts;

/// <summary>
/// A staged mindmap upload and what reading it turned up. Upload and preview are one response for
/// the same reason the note and flashcard sides are: an adapter can only preview a file already on
/// disk, so splitting them would buy a round trip that tells the client nothing new.
/// </summary>
/// <param name="MapCount">
/// Maps the file is expected to yield, read from the package manifest. Null only when the preview
/// could not read the file at all.
/// </param>
public sealed record MindmapTransferUploadDto(
    string UploadId,
    string FileName,
    long SizeBytes,
    string FormatId,
    string FormatName,
    bool CanImport,
    int? MapCount,
    IReadOnlyList<string> Warnings);

/// <summary>
/// Import body. Several uploads run as one batch so the client reports a single outcome for what the
/// user experienced as one action.
/// </summary>
/// <param name="ConflictPolicy">
/// <c>KeepBoth</c> (default), <c>Skip</c> or <c>Replace</c>. Maps collide by id.
/// </param>
/// <remarks>
/// There is no target folder here, unlike notes: a mindmap package carries the folders its maps were
/// filed in and restores them, so there is nothing for a caller to choose.
/// </remarks>
public sealed record MindmapTransferImportDto(
    IReadOnlyList<string> UploadIds,
    string? ConflictPolicy);

/// <summary>
/// What a batch import did. Per-file errors are collected rather than thrown so one unreadable file
/// in a batch does not discard the ones that imported.
/// </summary>
public sealed record MindmapTransferImportResultDto(
    int SucceededFiles,
    int FailedFiles,
    int ImportedMaps,
    IReadOnlyList<string> Warnings,
    IReadOnlyList<string> Errors);

/// <summary>
/// Export body. <paramref name="MapIds"/> is always explicit: the package adapter reads an empty
/// selection as "export every map", which is not a thing any caller here means.
/// </summary>
public sealed record MindmapTransferExportDto(string FormatId, IReadOnlyList<string> MapIds);
