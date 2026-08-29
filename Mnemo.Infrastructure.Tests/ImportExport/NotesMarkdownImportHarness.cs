using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.Notes.Persistence;
using Mnemo.Infrastructure.Services.Notes.Trash;
using Mnemo.Infrastructure.Services.Trash;
using Mnemo.Infrastructure.Tests.Notes;

namespace Mnemo.Infrastructure.Tests.ImportExport;

/// <summary>
/// Runs Markdown imports against a real note store and trash ledger in one temporary database.
/// </summary>
internal sealed class NotesMarkdownImportHarness : IAsyncDisposable
{
    private readonly string _directory;

    public NotesMarkdownImportHarness()
    {
        _directory = Path.Combine(Path.GetTempPath(), "mnemo-markdown-import-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_directory);
        var databasePath = Path.Combine(_directory, "mnemo.db");

        var logger = new RecordingLogger();
        Storage = new SqliteStorageProvider(logger, databasePath);
        Store = new NoteCommitStore(logger, databasePath);
        Notes = new NoteService(Storage, Store, Store, Store);
        Folders = new NoteFolderService(Storage, Store, Store);

        TrashDatabase = new TrashDatabase(logger, databasePath);
        Trash = new TrashService(
            new TrashStore(TrashDatabase),
            new TrashSourceRegistry([new NoteTrashSource(Store)]),
            logger);
    }

    public SqliteStorageProvider Storage { get; }

    public NoteCommitStore Store { get; }

    public NoteService Notes { get; }

    public NoteFolderService Folders { get; }

    public TrashDatabase TrashDatabase { get; }

    public TrashService Trash { get; }

    /// <summary>The adapter under test, with either collaborator swapped for a double.</summary>
    public NotesMarkdownFormatAdapter Adapter(INoteService? notes = null, ITrashService? trash = null) =>
        new(notes ?? Notes, trash ?? Trash);

    /// <summary>Writes a note through the service and reads back what was stored.</summary>
    public async Task<Note> SeedAsync(Note note)
    {
        Assert.True((await Notes.SaveNoteAsync(note)).IsSuccess);
        return (await Notes.GetNoteAsync(note.NoteId))!;
    }

    public Task<Note> SeedNoteAsync(string title, string? folderId = null, string body = "original") =>
        SeedAsync(new Note { Title = title, FolderId = folderId, Blocks = [TextBlock(body)] });

    public async Task<NoteFolder> SeedFolderAsync(string name)
    {
        var folder = new NoteFolder { Name = name };
        Assert.True((await Folders.SaveFolderAsync(folder)).IsSuccess);
        return folder;
    }

    /// <summary>A file on disk for the adapter to read, named the way an upload would be.</summary>
    public async Task<string> FileAsync(string fileName, string markdown)
    {
        var path = Path.Combine(_directory, fileName);
        await File.WriteAllTextAsync(path, markdown);
        return path;
    }

    public Task<ImportExportResult> ImportAsync(
        NotesMarkdownFormatAdapter adapter,
        string filePath,
        ImportConflictPolicy policy,
        string? targetFolderId = null)
    {
        var request = new ImportExportRequest
        {
            ContentType = "notes",
            FormatId = "notes.markdown",
            FilePath = filePath,
        };
        request.Options[ImportExportOptionKeys.ConflictPolicy] = policy;
        if (targetFolderId is not null)
            request.Options[ImportExportOptionKeys.TargetFolderId] = targetFolderId;

        return adapter.ImportAsync(request);
    }

    /// <summary>Every held entry, newest first.</summary>
    public async Task<IReadOnlyList<TrashEntry>> HeldAsync()
    {
        var page = await Trash.ListAsync(new TrashListQuery(Limit: 100));
        return [.. page.Entries.Select(listing => listing.Entry)];
    }

    /// <summary>
    /// Returns the indexed note ids used to retain referenced images.
    /// </summary>
    public async Task<List<string>> IndexAsync() =>
        (await Storage.LoadAsync<List<string>>("notes_index")).Value ?? [];

    public static Block TextBlock(string text) =>
        new() { Type = BlockType.Text, Spans = [InlineSpan.Plain(text)] };

    public async ValueTask DisposeAsync()
    {
        Trash.Dispose();
        await TrashDatabase.DisposeAsync();
        await Store.DisposeAsync();
        try
        {
            Directory.Delete(_directory, recursive: true);
        }
        catch (IOException)
        {
            // A scratch directory that outlives the test run is noise, not a failure.
        }
    }
}

/// <summary>
/// Delegates to the real trash except for an injected delete failure or empty capture.
/// </summary>
internal sealed class UnreachableTrashService : ITrashService
{
    private readonly ITrashService _inner;
    private readonly Exception? _failure;

    /// <param name="inner">The real trash, which every other call goes to.</param>
    /// <param name="failure">Thrown by a delete, or null for a delete that captures nothing.</param>
    public UnreachableTrashService(ITrashService inner, Exception? failure = null)
    {
        _inner = inner;
        _failure = failure;
    }

    public IReadOnlyCollection<string> RegisteredKinds => _inner.RegisteredKinds;

    public Task<TrashAction> DeleteAsync(
        IReadOnlyCollection<TrashDeleteRequest> items,
        CancellationToken cancellationToken = default) =>
        _failure is null
            ? Task.FromResult(new TrashAction(Guid.NewGuid().ToString("N"), [], items.Count))
            : Task.FromException<TrashAction>(_failure);

    public Task<TrashPage> ListAsync(TrashListQuery query, CancellationToken cancellationToken = default) =>
        _inner.ListAsync(query, cancellationToken);

    public Task<int> CountAsync(CancellationToken cancellationToken = default) =>
        _inner.CountAsync(cancellationToken);

    public Task<IReadOnlyList<TrashRestoreResult>> RestoreAsync(
        IReadOnlyCollection<string> entryIds,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default) =>
        _inner.RestoreAsync(entryIds, target, cancellationToken);

    public Task<IReadOnlyList<TrashRestoreResult>> RestoreBatchAsync(
        string batchId,
        CancellationToken cancellationToken = default) =>
        _inner.RestoreBatchAsync(batchId, cancellationToken);

    public Task<TrashPurgeResult> PurgeAsync(string entryId, CancellationToken cancellationToken = default) =>
        _inner.PurgeAsync(entryId, cancellationToken);

    public Task<TrashEmptyResult> EmptyAsync(CancellationToken cancellationToken = default) =>
        _inner.EmptyAsync(cancellationToken);

    public Task<int> SweepExpiredAsync(CancellationToken cancellationToken = default) =>
        _inner.SweepExpiredAsync(cancellationToken);

    public Task ReconcileAsync(CancellationToken cancellationToken = default) =>
        _inner.ReconcileAsync(cancellationToken);
}

/// <summary>
/// Fails a selected save through the service result, matching the production failure contract.
/// </summary>
internal sealed class FailingSaveNoteService : INoteService
{
    private readonly INoteService _inner;
    private readonly int _failingSave;
    private int _saves;

    /// <param name="inner">The real note service.</param>
    /// <param name="failingSave">Which save reports a failure, counting from one.</param>
    public FailingSaveNoteService(INoteService inner, int failingSave)
    {
        _inner = inner;
        _failingSave = failingSave;
    }

    public Task<IEnumerable<Note>> GetAllNotesAsync() => _inner.GetAllNotesAsync();

    public Task<IReadOnlyList<NoteSummary>> GetAllNoteSummariesAsync() => _inner.GetAllNoteSummariesAsync();

    public Task<Note?> GetNoteAsync(string noteId) => _inner.GetNoteAsync(noteId);

    public Task<Result> SaveNoteAsync(Note note)
    {
        _saves++;
        return _saves == _failingSave
            ? Task.FromResult(Result.Failure($"Note {note.NoteId} could not be written."))
            : _inner.SaveNoteAsync(note);
    }

    public Task<Result> DeleteNoteAsync(string noteId) => _inner.DeleteNoteAsync(noteId);
}
