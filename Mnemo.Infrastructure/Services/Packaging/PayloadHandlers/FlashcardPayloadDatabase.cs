using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// The <c>flashcards.db</c> file inside a <c>.mnemo</c> package: a SQLite database of one table per
/// kind of row, each holding an id and a JSON snapshot.
/// </summary>
/// <remarks>
/// <c>Decks</c> and <c>Folders</c> are the original two tables and their shape is frozen, so a
/// package this build writes still opens in a build that predates the rest. Every later table is
/// read only if it is there, which is what lets an older package import unchanged.
/// </remarks>
internal static class FlashcardPayloadDatabase
{
    public const string FileName = "flashcards.db";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private const string CreateSql = """
        CREATE TABLE IF NOT EXISTS Decks (
            DeckId TEXT PRIMARY KEY,
            Json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS Folders (
            FolderId TEXT PRIMARY KEY,
            Json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS Presets (
            PresetId TEXT PRIMARY KEY,
            Json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS CardTypes (
            TypeId TEXT PRIMARY KEY,
            Json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS Facts (
            FactId TEXT PRIMARY KEY,
            Json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS Reviews (
            ReviewId INTEGER PRIMARY KEY,
            Json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS DailyStats (
            DeckId TEXT NOT NULL,
            Day TEXT NOT NULL,
            Json TEXT NOT NULL,
            PRIMARY KEY (DeckId, Day)
        );
        """;

    /// <summary>Writes a whole snapshot into a fresh database and returns its bytes.</summary>
    public static byte[] Write(FlashcardPayloadSnapshot snapshot)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-flashcards-{Guid.NewGuid():N}.db");
        try
        {
            // Pooling is off so disposing the connection releases the temp file immediately, without
            // a process wide pool clear that would disrupt other stores' live connections.
            using (var connection = new SqliteConnection($"Data Source={tempPath};Pooling=False"))
            {
                connection.Open();
                using (var create = connection.CreateCommand())
                {
                    create.CommandText = CreateSql;
                    create.ExecuteNonQuery();
                }

                using var tx = connection.BeginTransaction();
                InsertAll(connection, tx, "Decks", "DeckId", snapshot.Decks, d => d.Id);
                InsertAll(connection, tx, "Folders", "FolderId", snapshot.Folders, f => f.Id);
                InsertAll(connection, tx, "Presets", "PresetId", snapshot.Presets, p => p.Id);
                InsertAll(connection, tx, "CardTypes", "TypeId", snapshot.CardTypes, t => t.Id);
                InsertAll(connection, tx, "Facts", "FactId", snapshot.Facts, f => f.Id);
                InsertAll(connection, tx, "Reviews", "ReviewId", snapshot.Reviews, r => r.Id);
                InsertDailyStats(connection, tx, snapshot.DailyStats);
                tx.Commit();
            }

            return File.ReadAllBytes(tempPath);
        }
        finally
        {
            Delete(tempPath);
        }
    }

    /// <summary>
    /// Reads a package's database back. Tables the writing build did not have are simply absent and
    /// come back empty.
    /// </summary>
    public static FlashcardPayloadSnapshot Read(byte[] databaseBytes)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-flashcards-import-{Guid.NewGuid():N}.db");
        try
        {
            File.WriteAllBytes(tempPath, databaseBytes);
            var snapshot = new FlashcardPayloadSnapshot();
            using var connection = new SqliteConnection($"Data Source={tempPath};Pooling=False");
            connection.Open();

            var present = ReadTableNames(connection);
            ReadInto(connection, present, "Decks", snapshot.Decks);
            ReadInto(connection, present, "Folders", snapshot.Folders);
            ReadInto(connection, present, "Presets", snapshot.Presets);
            ReadInto(connection, present, "CardTypes", snapshot.CardTypes);
            ReadInto(connection, present, "Facts", snapshot.Facts);
            ReadInto(connection, present, "Reviews", snapshot.Reviews);
            ReadInto(connection, present, "DailyStats", snapshot.DailyStats);
            return snapshot;
        }
        finally
        {
            Delete(tempPath);
        }
    }

    private static void InsertAll<T>(
        SqliteConnection connection,
        SqliteTransaction tx,
        string table,
        string idColumn,
        IReadOnlyList<T> rows,
        Func<T, object> id)
    {
        foreach (var row in rows)
        {
            using var insert = connection.CreateCommand();
            insert.Transaction = tx;
            insert.CommandText = $"INSERT OR REPLACE INTO {table} ({idColumn}, Json) VALUES ($id, $json)";
            insert.Parameters.AddWithValue("$id", id(row));
            insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(row, JsonOptions));
            insert.ExecuteNonQuery();
        }
    }

    private static void InsertDailyStats(SqliteConnection connection, SqliteTransaction tx, IReadOnlyList<DailyStatSnapshotDto> rows)
    {
        foreach (var row in rows)
        {
            using var insert = connection.CreateCommand();
            insert.Transaction = tx;
            insert.CommandText = "INSERT OR REPLACE INTO DailyStats (DeckId, Day, Json) VALUES ($deck, $day, $json)";
            insert.Parameters.AddWithValue("$deck", row.DeckId);
            insert.Parameters.AddWithValue("$day", row.Date);
            insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(row, JsonOptions));
            insert.ExecuteNonQuery();
        }
    }

    private static HashSet<string> ReadTableNames(SqliteConnection connection)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table'";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
            names.Add(reader.GetString(0));
        return names;
    }

    private static void ReadInto<T>(SqliteConnection connection, HashSet<string> present, string table, List<T> into)
    {
        if (!present.Contains(table))
            return;

        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT Json FROM {table}";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var row = JsonSerializer.Deserialize<T>(reader.GetString(0), JsonOptions);
            if (row is not null)
                into.Add(row);
        }
    }

    private static void Delete(string path)
    {
        if (!File.Exists(path))
            return;
        try { File.Delete(path); } catch (IOException) { }
    }
}
