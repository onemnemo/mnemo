namespace Mnemo.Host.Contracts;

/// <summary>
/// A staged note upload and what reading it turned up. Upload and preview are one response for the
/// same reason the flashcard side is: the adapters can only preview a file already on disk, so
/// splitting them would buy a round trip that tells the client nothing new.
/// </summary>
/// <param name="NoteCount">
/// Notes the file is expected to yield. Unlike the flashcard formats, both note formats report a
/// count worth trusting: a package reads its manifest, and a markdown file always maps to exactly
/// one note by construction. Null only if a preview could not read the file at all.
/// </param>
public sealed record NoteTransferUploadDto(
    string UploadId,
    string FileName,
    long SizeBytes,
    string FormatId,
    string FormatName,
    bool CanImport,
    int? NoteCount,
    IReadOnlyList<TransferWarningDto> Warnings);

/// <summary>
/// Import body. Several uploads run as one batch so the client reports a single outcome for what
/// the user experienced as one action.
/// </summary>
/// <param name="ConflictPolicy">
/// <c>KeepBoth</c> (default), <c>Skip</c> or <c>Replace</c>. A package collides by note id; a
/// markdown file, carrying no id, collides by title.
/// </param>
/// <param name="TargetFolderId">
/// Folder a markdown import lands in, so importing while a folder is open files the note there
/// rather than at the root. A package restores its own folder structure and ignores this.
/// </param>
public sealed record NoteTransferImportDto(
    IReadOnlyList<string> UploadIds,
    string? ConflictPolicy,
    string? TargetFolderId);

/// <summary>
/// What a batch import did. Per-file errors are collected rather than thrown so one unreadable file
/// in a batch does not discard the ones that imported.
/// </summary>
public sealed record NoteTransferImportResultDto(
    int SucceededFiles,
    int FailedFiles,
    int ImportedNotes,
    IReadOnlyList<TransferWarningDto> Warnings,
    IReadOnlyList<string> Errors);

/// <summary>
/// Export body. <paramref name="NoteIds"/> is always explicit: the package adapter reads an empty
/// selection as "export every note", which is not a thing any caller here means. Markdown exports a
/// single note only, so a markdown request with anything other than one id is rejected.
/// </summary>
public sealed record NoteTransferExportDto(string FormatId, IReadOnlyList<string> NoteIds);
