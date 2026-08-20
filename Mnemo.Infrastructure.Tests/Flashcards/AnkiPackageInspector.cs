using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>One note as a written package holds it.</summary>
internal sealed record AnkiPackageNote(long Id, long ModelId, IReadOnlyList<string> Fields, string Tags);

/// <summary>One card row as a written package holds it.</summary>
internal sealed record AnkiPackageCard(long Id, long NoteId, int Ord);

/// <summary>One answer as a written package's review log holds it.</summary>
internal sealed record AnkiPackageReview(long Id, long CardId, int Ease, int Interval, int LastInterval, int Type);

/// <summary>What a written package contains, read straight out of its collection database.</summary>
internal sealed record AnkiPackageContents(
    IReadOnlyList<AnkiPackageNote> Notes,
    IReadOnlyList<AnkiPackageCard> Cards,
    IReadOnlyList<AnkiPackageReview> Reviews,
    string ModelsJson);

/// <summary>
/// Reads a package this app wrote, so an export can be asserted on as the file it produced rather
/// than through the import that reads it back. A round trip that only ever checks itself proves
/// the two halves agree, not that either is right.
/// </summary>
internal static class AnkiPackageInspector
{
    public static async Task<AnkiPackageContents> ReadAsync(string packagePath)
    {
        var workRoot = Path.Combine(Path.GetTempPath(), $"mnemo_anki_read_{Guid.NewGuid():N}");
        Directory.CreateDirectory(workRoot);
        try
        {
            ZipFile.ExtractToDirectory(packagePath, workRoot);
            var collectionPath = Path.Combine(workRoot, "collection.anki2");

            var connectionString = new SqliteConnectionStringBuilder
            {
                DataSource = collectionPath,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false,
            }.ToString();

            await using var connection = new SqliteConnection(connectionString);
            await connection.OpenAsync().ConfigureAwait(false);

            var notes = new List<AnkiPackageNote>();
            await ReadAsync(connection, "SELECT id, mid, flds, tags FROM notes ORDER BY id", reader =>
                notes.Add(new AnkiPackageNote(
                    reader.GetInt64(0),
                    reader.GetInt64(1),
                    reader.GetString(2).Split(AnkiPackageFixture.UnitSeparator),
                    reader.GetString(3)))).ConfigureAwait(false);

            var cards = new List<AnkiPackageCard>();
            await ReadAsync(connection, "SELECT id, nid, ord FROM cards ORDER BY nid, ord", reader =>
                cards.Add(new AnkiPackageCard(reader.GetInt64(0), reader.GetInt64(1), reader.GetInt32(2))))
                .ConfigureAwait(false);

            var reviews = new List<AnkiPackageReview>();
            await ReadAsync(connection, "SELECT id, cid, ease, ivl, lastIvl, type FROM revlog ORDER BY cid, id", reader =>
                reviews.Add(new AnkiPackageReview(
                    reader.GetInt64(0), reader.GetInt64(1), reader.GetInt32(2),
                    reader.GetInt32(3), reader.GetInt32(4), reader.GetInt32(5))))
                .ConfigureAwait(false);

            var models = string.Empty;
            await ReadAsync(connection, "SELECT models FROM col LIMIT 1", reader => models = reader.GetString(0))
                .ConfigureAwait(false);

            return new AnkiPackageContents(notes, cards, reviews, models);
        }
        finally
        {
            // No pool to clear: the collection above is opened with Pooling=False, so its file is
            // already released by the time this runs.
            try { Directory.Delete(workRoot, recursive: true); } catch (IOException) { }
        }
    }

    private static async Task ReadAsync(SqliteConnection connection, string sql, Action<SqliteDataReader> read)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync().ConfigureAwait(false);
        while (await reader.ReadAsync().ConfigureAwait(false))
            read(reader);
    }
}
