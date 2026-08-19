using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using ZstdSharp;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Which of Anki's package layouts a fixture should be written in.</summary>
internal enum AnkiFixtureLayout
{
    /// <summary>A plain collection database beside a JSON media table.</summary>
    Legacy,

    /// <summary>
    /// The current layout: a zstd collection database on the newer schema, a zstd protobuf media
    /// table, zstd media payloads, and a stub collection under the old name for older Anki builds.
    /// </summary>
    Modern,
}

/// <summary>
/// One note in a fixture package, and the deck it belongs to. <paramref name="ExtraFields"/> stands
/// in for a note type that carries more than the two sides a card here has room for.
/// </summary>
internal sealed record AnkiFixtureCard(
    string DeckName,
    string FrontHtml,
    string BackHtml,
    string Tags = "",
    IReadOnlyList<string>? ExtraFields = null);

/// <summary>
/// Writes representative Anki packages for import tests. Real packages are not checked in, so
/// each layout is assembled here from its actual on-disk shape rather than mocked away.
/// </summary>
internal static class AnkiPackageFixture
{
    public const char UnitSeparator = '';

    /// <summary>
    /// Groups the package tests into one xUnit collection. They assert on what is left behind in
    /// the shared temp directory, which two of them running at once would make meaningless.
    /// </summary>
    public const string TestCollection = "Anki packages";

    private const long BasicNotetypeId = 1608194021001L;
    private const string BasicNotetypeName = "Basic";

    public static async Task<string> WriteAsync(
        AnkiFixtureLayout layout,
        IReadOnlyList<AnkiFixtureCard> cards,
        IReadOnlyDictionary<string, byte[]> media)
    {
        var workRoot = Path.Combine(Path.GetTempPath(), $"mnemo_anki_fixture_{Guid.NewGuid():N}");
        Directory.CreateDirectory(workRoot);
        var packagePath = Path.Combine(Path.GetTempPath(), $"mnemo_anki_{Guid.NewGuid():N}.apkg");

        try
        {
            var collectionPath = Path.Combine(workRoot, "collection.db");
            await WriteCollectionAsync(collectionPath, layout, cards).ConfigureAwait(false);
            SqliteConnection.ClearAllPools();

            if (layout == AnkiFixtureLayout.Legacy)
                WriteLegacyPackage(packagePath, collectionPath, media);
            else
                await WriteModernPackageAsync(packagePath, collectionPath, workRoot, media).ConfigureAwait(false);

            return packagePath;
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            try { Directory.Delete(workRoot, recursive: true); } catch (IOException) { }
        }
    }

    private static void WriteLegacyPackage(string packagePath, string collectionPath, IReadOnlyDictionary<string, byte[]> media)
    {
        using var file = File.Create(packagePath);
        using var archive = new ZipArchive(file, ZipArchiveMode.Create);

        WriteEntry(archive, "collection.anki2", File.ReadAllBytes(collectionPath));

        var mediaTable = new Dictionary<string, string>(StringComparer.Ordinal);
        var slot = 0;
        foreach (var (name, bytes) in media)
        {
            var storedName = slot.ToString(CultureInfo.InvariantCulture);
            WriteEntry(archive, storedName, bytes);
            mediaTable[storedName] = name;
            slot++;
        }

        WriteEntry(archive, "media", Encoding.UTF8.GetBytes(JsonSerializer.Serialize(mediaTable)));
    }

    private static async Task WriteModernPackageAsync(
        string packagePath,
        string collectionPath,
        string workRoot,
        IReadOnlyDictionary<string, byte[]> media)
    {
        var stubPath = Path.Combine(workRoot, "stub.db");
        await WriteCollectionAsync(stubPath, AnkiFixtureLayout.Legacy, Array.Empty<AnkiFixtureCard>()).ConfigureAwait(false);
        SqliteConnection.ClearAllPools();

        using var file = File.Create(packagePath);
        using var archive = new ZipArchive(file, ZipArchiveMode.Create);

        // Field 1 of the package header is the format version; 3 is the current layout.
        WriteEntry(archive, "meta", [0x08, 0x03]);

        // Older Anki builds open this one and tell the user to upgrade. Anything that reads it as
        // the real collection imports an empty deck.
        WriteEntry(archive, "collection.anki2", File.ReadAllBytes(stubPath));
        WriteEntry(archive, "collection.anki21b", Compress(File.ReadAllBytes(collectionPath)));

        var entries = new List<byte[]>();
        var slot = 0;
        foreach (var (name, bytes) in media)
        {
            WriteEntry(archive, slot.ToString(CultureInfo.InvariantCulture), Compress(bytes));
            entries.Add(MediaEntryBytes(name, bytes.Length));
            slot++;
        }

        WriteEntry(archive, "media", Compress(MediaEntriesBytes(entries)));
    }

    /// <summary>
    /// The media table of the current layout: a repeated protobuf field whose position is the name
    /// of the file inside the archive.
    /// </summary>
    private static byte[] MediaEntriesBytes(IReadOnlyList<byte[]> entries)
    {
        var buffer = new List<byte>();
        foreach (var entry in entries)
        {
            buffer.Add(0x0A);
            buffer.AddRange(Varint((ulong)entry.Length));
            buffer.AddRange(entry);
        }

        return buffer.ToArray();
    }

    private static byte[] MediaEntryBytes(string name, int size)
    {
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var buffer = new List<byte> { 0x0A };
        buffer.AddRange(Varint((ulong)nameBytes.Length));
        buffer.AddRange(nameBytes);

        // A field the reader has no use for, so the fixture proves it steps over one correctly.
        buffer.Add(0x10);
        buffer.AddRange(Varint((ulong)size));
        return buffer.ToArray();
    }

    private static IEnumerable<byte> Varint(ulong value)
    {
        while (value >= 0x80)
        {
            yield return (byte)(value | 0x80);
            value >>= 7;
        }

        yield return (byte)value;
    }

    private static byte[] Compress(byte[] payload)
    {
        using var compressor = new Compressor();
        return compressor.Wrap(payload).ToArray();
    }

    private static void WriteEntry(ZipArchive archive, string name, byte[] bytes)
    {
        // Anki stores rather than deflates: the payloads are already compressed.
        var entry = archive.CreateEntry(name, CompressionLevel.NoCompression);
        using var stream = entry.Open();
        stream.Write(bytes, 0, bytes.Length);
    }

    private static async Task WriteCollectionAsync(string databasePath, AnkiFixtureLayout layout, IReadOnlyList<AnkiFixtureCard> cards)
    {
        await using var connection = new SqliteConnection($"Data Source={databasePath};Pooling=False");
        await connection.OpenAsync().ConfigureAwait(false);

        await ExecAsync(connection, """
            CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER,
                dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT);
            CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER,
                tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT);
            CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER,
                usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER,
                reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT);
            """).ConfigureAwait(false);

        var deckIds = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var card in cards)
        {
            if (!deckIds.ContainsKey(card.DeckName))
                deckIds[card.DeckName] = 1500000000001L + deckIds.Count;
        }

        if (layout == AnkiFixtureLayout.Legacy)
        {
            await WriteLegacyNameColumnsAsync(connection, deckIds).ConfigureAwait(false);
        }
        else
        {
            await WriteModernNameTablesAsync(connection, deckIds).ConfigureAwait(false);
        }

        var noteId = 100L;
        var cardId = 200L;
        foreach (var card in cards)
        {
            var fields = $"{card.FrontHtml}{UnitSeparator}{card.BackHtml}";
            if (card.ExtraFields is { Count: > 0 })
                fields += UnitSeparator + string.Join(UnitSeparator, card.ExtraFields);

            await ExecAsync(
                connection,
                "INSERT INTO notes(id,guid,mid,mod,usn,tags,flds,sfld,csum,flags,data) " +
                "VALUES(@id, @guid, @mid, 0, 0, @tags, @flds, '', 0, 0, '');",
                ("@id", noteId),
                ("@guid", $"g{noteId}"),
                ("@mid", BasicNotetypeId),
                ("@tags", card.Tags),
                ("@flds", fields)).ConfigureAwait(false);

            await ExecAsync(
                connection,
                "INSERT INTO cards(id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data) " +
                "VALUES(@id, @nid, @did, 0, 0, 0, 0, 0, 0, 0, 2500, 0, 0, 0, 0, 0, 0, '');",
                ("@id", cardId),
                ("@nid", noteId),
                ("@did", deckIds[card.DeckName])).ConfigureAwait(false);

            noteId++;
            cardId++;
        }
    }

    private static async Task WriteLegacyNameColumnsAsync(SqliteConnection connection, IReadOnlyDictionary<string, long> deckIds)
    {
        var decks = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (name, id) in deckIds)
            decks[id.ToString(CultureInfo.InvariantCulture)] = new Dictionary<string, object?> { ["id"] = id, ["name"] = name };

        var models = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [BasicNotetypeId.ToString(CultureInfo.InvariantCulture)] =
                new Dictionary<string, object?> { ["id"] = BasicNotetypeId, ["name"] = BasicNotetypeName }
        };

        await ExecAsync(
            connection,
            "INSERT INTO col(id,crt,mod,scm,ver,dty,usn,ls,conf,models,decks,dconf,tags) " +
            "VALUES(1, 0, 0, 0, 11, 0, 0, 0, '{}', @models, @decks, '{}', '{}');",
            ("@models", JsonSerializer.Serialize(models)),
            ("@decks", JsonSerializer.Serialize(decks))).ConfigureAwait(false);
    }

    /// <summary>
    /// The current schema keeps the two name columns present but empty and moves the names into
    /// tables of their own, with a unit separator between the levels of a deck's hierarchy.
    /// </summary>
    private static async Task WriteModernNameTablesAsync(SqliteConnection connection, IReadOnlyDictionary<string, long> deckIds)
    {
        await ExecAsync(connection, """
            CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, mtime_secs INTEGER NOT NULL,
                usn INTEGER NOT NULL, common BLOB NOT NULL, kind BLOB NOT NULL);
            CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, mtime_secs INTEGER NOT NULL,
                usn INTEGER NOT NULL, config BLOB NOT NULL);
            """).ConfigureAwait(false);

        await ExecAsync(
            connection,
            "INSERT INTO col(id,crt,mod,scm,ver,dty,usn,ls,conf,models,decks,dconf,tags) " +
            "VALUES(1, 0, 0, 0, 18, 0, 0, 0, '{}', '', '', '{}', '{}');").ConfigureAwait(false);

        foreach (var (name, id) in deckIds)
        {
            await ExecAsync(
                connection,
                "INSERT INTO decks(id,name,mtime_secs,usn,common,kind) VALUES(@id, @name, 0, 0, x'', x'');",
                ("@id", id),
                ("@name", name.Replace("::", UnitSeparator.ToString(), StringComparison.Ordinal))).ConfigureAwait(false);
        }

        await ExecAsync(
            connection,
            "INSERT INTO notetypes(id,name,mtime_secs,usn,config) VALUES(@id, @name, 0, 0, x'');",
            ("@id", BasicNotetypeId),
            ("@name", BasicNotetypeName)).ConfigureAwait(false);
    }

    private static async Task ExecAsync(SqliteConnection connection, string sql, params (string Name, object Value)[] parameters)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
            command.Parameters.AddWithValue(name, value);
        await command.ExecuteNonQueryAsync().ConfigureAwait(false);
    }
}
