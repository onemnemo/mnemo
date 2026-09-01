using System.Text;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Notes.Persistence;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Notes;

/// <summary>
/// The bytes the notes list endpoint sends. The list is built from a read that leaves every note's
/// body in storage, and this is what holds that read to the one that loads the notes whole: same
/// notes, same fields, same order, same bytes on the wire.
/// </summary>
public sealed class NoteSummaryResponseTests
{
    /// <summary>What minimal APIs serialize a returned list with.</summary>
    private static readonly JsonSerializerOptions ResponseJson = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task The_list_serializes_to_the_same_bytes_as_loading_every_note_whole()
    {
        await using var h = new NotesReadHarness();
        await SeedCorpusAsync(h);

        var fromWholeNotes = Serialize(
            (await h.Notes.GetAllNotesAsync()).Select(n => NoteSummaryDto.FromSummary(NoteSummary.FromNote(n))).ToList());
        var fromSummaries = Serialize(
            (await h.Notes.GetAllNoteSummariesAsync()).Select(NoteSummaryDto.FromSummary).ToList());

        Assert.Equal(
            Encoding.UTF8.GetString(fromWholeNotes),
            Encoding.UTF8.GetString(fromSummaries));
        Assert.Equal(fromWholeNotes, fromSummaries);
    }

    /// <summary>
    /// A timestamp that came back from storage without a kind is stamped UTC on the way out so the
    /// SPA reads it as UTC. Stamping is all it is: the clock reading does not move. Converting it
    /// instead would read the value as local time and shift it by the machine's offset, which on the
    /// list endpoint would redate every note written by an older build.
    /// </summary>
    [Fact]
    public async Task A_timestamp_stored_without_a_kind_is_labelled_utc_rather_than_converted_to_it()
    {
        await using var h = new NotesReadHarness();
        await h.SeedAsync(new Note
        {
            NoteId = "no-kind",
            Title = "No kind",
            CreatedAt = new DateTime(2025, 3, 4, 5, 6, 7, DateTimeKind.Unspecified),
            ModifiedAt = new DateTime(2025, 3, 4, 5, 6, 7, DateTimeKind.Unspecified),
        });

        var json = Encoding.UTF8.GetString(Serialize(
            (await h.Notes.GetAllNoteSummariesAsync()).Select(NoteSummaryDto.FromSummary).ToList()));

        Assert.Contains("\"createdAt\":\"2025-03-04T05:06:07Z\"", json, StringComparison.Ordinal);
        Assert.Contains("\"modifiedAt\":\"2025-03-04T05:06:07Z\"", json, StringComparison.Ordinal);
    }

    private static byte[] Serialize(IReadOnlyList<NoteSummaryDto> summaries) =>
        JsonSerializer.SerializeToUtf8Bytes(summaries, ResponseJson);

    /// <summary>
    /// Rows carrying what the two reads could disagree about: unset optional fields, set ones, tags,
    /// a favourite, a version and short id, timestamps in every kind, and two notes sharing an
    /// instant so their relative order is part of the comparison.
    /// </summary>
    private static async Task SeedCorpusAsync(NotesReadHarness h)
    {
        var shared = new DateTime(2025, 4, 1, 12, 0, 0, DateTimeKind.Utc);

        await h.SeedAsync(new Note
        {
            NoteId = "bare",
            Title = "Bare",
            CreatedAt = new DateTime(2023, 1, 2, 12, 0, 0, DateTimeKind.Utc),
            ModifiedAt = new DateTime(2023, 1, 2, 12, 0, 0, DateTimeKind.Utc),
        });

        await h.SeedAsync(new Note
        {
            NoteId = "decorated",
            Title = "Decorated",
            Sid = "n7k2",
            Ver = 41,
            FolderId = "folder-1",
            ParentNoteId = "parent-1",
            Order = 3,
            IsFavorite = true,
            Emoji = "*",
            Cover = "asset:cover-1",
            CoverCrop = """{"x":0,"y":0.1,"w":0.8,"h":0.6,"aspect":1.5}""",
            Tags = ["one", "two"],
            CreatedAt = new DateTime(2024, 8, 9, 12, 0, 0, DateTimeKind.Utc),
            ModifiedAt = new DateTime(2026, 2, 2, 12, 0, 0, DateTimeKind.Utc),
        });

        await h.SeedAsync(new Note
        {
            NoteId = "no-kind",
            Title = "Written without a kind",
            CreatedAt = new DateTime(2025, 7, 7, 7, 7, 7, DateTimeKind.Unspecified),
            ModifiedAt = new DateTime(2025, 7, 7, 7, 7, 7, DateTimeKind.Unspecified),
        });

        await h.SeedAsync(new Note
        {
            NoteId = "local",
            Title = "Written as local time",
            CreatedAt = new DateTime(2025, 9, 9, 9, 9, 9, DateTimeKind.Local),
            ModifiedAt = new DateTime(2025, 9, 9, 9, 9, 9, DateTimeKind.Local),
        });

        await h.SeedAsync(new Note { NoteId = "tied-a", Title = "Tied first", CreatedAt = shared, ModifiedAt = shared });
        await h.SeedAsync(new Note { NoteId = "tied-b", Title = "Tied second", CreatedAt = shared, ModifiedAt = shared });
    }

    /// <summary>
    /// The real note service over a throwaway database, seeded straight through storage because every
    /// write path stamps the modification time with the current instant and these rows need a history.
    /// </summary>
    private sealed class NotesReadHarness : IAsyncDisposable
    {
        private readonly string _dbPath;
        private readonly NoteCommitStore _store;
        private readonly SqliteStorageProvider _storage;

        public NotesReadHarness()
        {
            _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_host_notes_{Guid.NewGuid():N}.db");
            var logger = new SilentLogger();
            _storage = new SqliteStorageProvider(logger, _dbPath);
            _store = new NoteCommitStore(logger, _dbPath);
            Notes = new NoteService(_storage, _store, _store, _store);
        }

        public INoteService Notes { get; }

        public async Task SeedAsync(Note note)
        {
            await _storage.SaveAsync($"note_{note.NoteId}", note);

            var index = (await _storage.LoadAsync<List<string>>("notes_index")).Value ?? [];
            index.Add(note.NoteId);
            await _storage.SaveAsync("notes_index", index);
        }

        public async ValueTask DisposeAsync()
        {
            await _store.DisposeAsync();

            // Only this harness's database. ClearAllPools() is process global: it disposes the
            // native sqlite3 handle of any pooled connection whose owner the GC has collected,
            // anywhere in the process, which under parallel test collections closes a handle
            // another collection is mid-query on.
            using (var scope = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={_dbPath}"))
                Microsoft.Data.Sqlite.SqliteConnection.ClearPool(scope);

            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                try { File.Delete(_dbPath + suffix); }
                catch (IOException) { /* a held sidecar in scratch is not a test failure */ }
            }
        }

        private sealed class SilentLogger : ILoggerService
        {
            public void Log(LogLevel level, string category, string message, Exception? exception = null)
            {
            }
        }
    }
}
