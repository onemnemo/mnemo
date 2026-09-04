using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Modules.Proofing;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.Packaging;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.ImportExport;

/// <summary>
/// The notes package is the only route a user has to a file that holds notes, so what it does not
/// carry is lost. These cover the proofing half of that round trip.
/// </summary>
public sealed class NotesMnemoFormatAdapterProofingTests
{
    [Fact]
    public async Task APackageCarriesTheProofingChoicesOfTheNotesItHolds()
    {
        var source = new Profile();
        await source.AddNoteAsync("note-a", "Spanish practice");
        await source.Languages.SetAsync("note-a", new NoteLanguageEntry("custom", ["es-ES"]), CancellationToken.None);
        await source.Ignores.AddAsync("note-a", "myocyte", CancellationToken.None);
        await source.Personal.AddAsync("Ordbanken", null, CancellationToken.None);

        using var package = new PackageFile();
        var export = await source.Adapter.ExportAsync(new ImportExportRequest { FilePath = package.Path });
        Assert.True(export.Success);

        var target = new Profile();
        var import = await target.Adapter.ImportAsync(new ImportExportRequest { FilePath = package.Path });

        Assert.True(import.Success);
        Assert.Equal("es-ES", Assert.Single((await target.Languages.GetAsync("note-a", CancellationToken.None))!.Languages));
        Assert.Equal(["myocyte"], await target.Ignores.ListAsync("note-a", CancellationToken.None));
        Assert.Equal(["Ordbanken"], (await target.Personal.ListAsync(CancellationToken.None)).Select(w => w.Word));
    }

    [Fact]
    public async Task AnExportOfOneNoteLeavesTheOtherNotesChoicesBehind()
    {
        var source = new Profile();
        await source.AddNoteAsync("note-a", "Chosen");
        await source.AddNoteAsync("note-b", "Not chosen");
        await source.Languages.SetAsync("note-a", new NoteLanguageEntry("custom", ["es-ES"]), CancellationToken.None);
        await source.Languages.SetAsync("note-b", new NoteLanguageEntry("custom", ["nb-NO"]), CancellationToken.None);
        await source.Ignores.AddAsync("note-b", "myocyte", CancellationToken.None);

        using var package = new PackageFile();
        await source.Adapter.ExportAsync(new ImportExportRequest
        {
            FilePath = package.Path,
            Payload = new[] { "note-a" }
        });

        var target = new Profile();
        await target.Adapter.ImportAsync(new ImportExportRequest { FilePath = package.Path });

        Assert.NotNull(await target.Languages.GetAsync("note-a", CancellationToken.None));
        Assert.Null(await target.Languages.GetAsync("note-b", CancellationToken.None));
        Assert.Empty(await target.Ignores.ListAsync("note-b", CancellationToken.None));
    }

    [Fact]
    public async Task TheChoicesFollowANoteThatHadToBeStoredUnderANewId()
    {
        var source = new Profile();
        await source.AddNoteAsync("note-a", "Spanish practice");
        await source.Languages.SetAsync("note-a", new NoteLanguageEntry("custom", ["es-ES"]), CancellationToken.None);
        await source.Ignores.AddAsync("note-a", "myocyte", CancellationToken.None);

        using var package = new PackageFile();
        await source.Adapter.ExportAsync(new ImportExportRequest { FilePath = package.Path });

        // An unrelated note already holds the id the package uses, so the import mints a new one.
        // Following it is what keeps the incoming choices off the note that was already here.
        var target = new Profile();
        await target.AddNoteAsync("note-a", "Something else entirely");
        await target.Adapter.ImportAsync(new ImportExportRequest
        {
            FilePath = package.Path,
            Options = { [ImportExportOptionKeys.ConflictPolicy] = ImportConflictPolicy.KeepBoth }
        });

        var stored = (await target.Notes.GetAllNotesAsync()).Single(n => n.NoteId != "note-a");
        Assert.Equal("es-ES", Assert.Single((await target.Languages.GetAsync(stored.NoteId, CancellationToken.None))!.Languages));
        Assert.Equal(["myocyte"], await target.Ignores.ListAsync(stored.NoteId, CancellationToken.None));
        Assert.Null(await target.Languages.GetAsync("note-a", CancellationToken.None));
        Assert.Empty(await target.Ignores.ListAsync("note-a", CancellationToken.None));
    }

    [Fact]
    public async Task APackageWithoutProofingStillImportsItsNotes()
    {
        // What every package written before proofing had a payload looks like.
        var source = new Profile(carryProofing: false);
        await source.AddNoteAsync("note-a", "Older package");

        using var package = new PackageFile();
        await source.Adapter.ExportAsync(new ImportExportRequest { FilePath = package.Path });

        var target = new Profile();
        var import = await target.Adapter.ImportAsync(new ImportExportRequest { FilePath = package.Path });

        Assert.True(import.Success);
        Assert.Empty(import.Warnings);
        Assert.Equal("Older package", (await target.Notes.GetNoteAsync("note-a"))!.Title);
    }

    /// <summary>One installation: its notes, its proofing stores, and the adapter over both.</summary>
    private sealed class Profile
    {
        public Profile(bool carryProofing = true)
        {
            var settings = new MemorySettings();
            Personal = new PersonalDictionaryService(settings);
            Languages = new NoteLanguageService(settings);
            Ignores = new NoteIgnoreService(settings);

            var handlers = new List<IMnemoPayloadHandler> { new NotesMnemoPayloadHandler(Notes, Folders) };
            if (carryProofing)
                handlers.Add(new ProofingMnemoPayloadHandler(Personal, Languages, Ignores));

            Adapter = new NotesMnemoFormatAdapter(new MnemoPackageService(handlers, settings, new SilentLogger()));
        }

        public InMemoryNoteService Notes { get; } = new();

        public InMemoryFolderService Folders { get; } = new();

        public PersonalDictionaryService Personal { get; }

        public NoteLanguageService Languages { get; }

        public NoteIgnoreService Ignores { get; }

        public NotesMnemoFormatAdapter Adapter { get; }

        public Task AddNoteAsync(string noteId, string title) =>
            Notes.SaveNoteAsync(new Note { NoteId = noteId, Title = title });
    }

    private sealed class PackageFile : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            $"mnemo-proofing-{Guid.NewGuid():N}.mnemo");

        public void Dispose()
        {
            if (File.Exists(Path))
            {
                try { File.Delete(Path); } catch (IOException) { }
            }
        }
    }

    private sealed class InMemoryNoteService : INoteService
    {
        private readonly Dictionary<string, Note> _notes = new(StringComparer.Ordinal);

        public Task<IEnumerable<Note>> GetAllNotesAsync() => Task.FromResult<IEnumerable<Note>>(_notes.Values.ToArray());

        public Task<IReadOnlyList<NoteSummary>> GetAllNoteSummariesAsync()
            => Task.FromResult<IReadOnlyList<NoteSummary>>([.. _notes.Values.Select(NoteSummary.FromNote)]);

        public Task<Note?> GetNoteAsync(string noteId)
            => Task.FromResult(_notes.TryGetValue(noteId, out var note) ? note : null);

        public Task<Result> SaveNoteAsync(Note note)
        {
            _notes[note.NoteId] = note;
            return Task.FromResult(Result.Success());
        }

        public Task<Result> DeleteNoteAsync(string noteId)
        {
            _notes.Remove(noteId);
            return Task.FromResult(Result.Success());
        }
    }

    private sealed class InMemoryFolderService : INoteFolderService
    {
        private readonly Dictionary<string, NoteFolder> _folders = new(StringComparer.Ordinal);

        public Task<IEnumerable<NoteFolder>> GetAllFoldersAsync()
            => Task.FromResult<IEnumerable<NoteFolder>>(_folders.Values.ToArray());

        public Task<NoteFolder?> GetFolderAsync(string folderId)
            => Task.FromResult(_folders.TryGetValue(folderId, out var folder) ? folder : null);

        public Task<Result> SaveFolderAsync(NoteFolder folder)
        {
            _folders[folder.FolderId] = folder;
            return Task.FromResult(Result.Success());
        }

        public Task<Result> DeleteFolderAsync(string folderId)
        {
            _folders.Remove(folderId);
            return Task.FromResult(Result.Success());
        }
    }
}
