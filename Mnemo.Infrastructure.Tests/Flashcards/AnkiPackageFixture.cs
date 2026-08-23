using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
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
/// One card row's scheduling, in the columns Anki keeps it in. <paramref name="Due"/> is whole days
/// since the collection was made for a review card, and an absolute second for one mid-session.
/// </summary>
/// <param name="OriginalDeckId">Non-zero when the card is parked in a filtered deck.</param>
internal sealed record AnkiFixtureScheduling(
    int Type = 0,
    int Queue = 0,
    long Due = 0,
    int Interval = 0,
    int Reps = 0,
    int Lapses = 0,
    long OriginalDue = 0,
    long OriginalDeckId = 0);

/// <summary>
/// One of a note type's templates, in the two format strings Anki keeps a card's question and
/// answer in. A marker naming a field prints that field, and <c>{{FrontSide}}</c> on an answer
/// repeats the question.
/// </summary>
internal sealed record AnkiFixtureTemplate(string Name, string QuestionFormat, string AnswerFormat);

/// <summary>
/// A note type a fixture note is written under, for when the two sides of one
/// <see cref="AnkiFixtureCard"/> are not the whole story: named fields, and the templates that
/// decide what each of a note's cards shows. A note written under one lands a card row per
/// template rather than the single row a plain fixture note lands.
/// </summary>
internal sealed record AnkiFixtureNoteType(
    long Id,
    string Name,
    IReadOnlyList<string> FieldNames,
    IReadOnlyList<AnkiFixtureTemplate> Templates,
    bool IsCloze = false);

/// <summary>
/// One answer in a collection's review log, in the columns Anki keeps it in.
/// </summary>
/// <param name="At">When it was answered. The row's key is this instant in milliseconds.</param>
/// <param name="Ease">The button pressed, one to four. Zero is a reschedule rather than an answer.</param>
/// <param name="Interval">The interval it set, positive in whole days and negative in seconds.</param>
/// <param name="LastInterval">The interval the card had waited, spelled the same way.</param>
/// <param name="Type">Which queue it came from: learn, review, relearn, or a filtered deck.</param>
internal sealed record AnkiFixtureReview(
    DateTimeOffset At,
    int Ease,
    int Interval,
    int LastInterval = 0,
    int Type = 1);

/// <summary>
/// One card row of a note, for a note whose rows are not simply one per template. A cloze note
/// makes a row per deletion, numbered from zero for the deletion written as <c>c1</c>, and each of
/// them carries its own history.
/// </summary>
/// <param name="DeckName">Which deck this one row sits in, or null for the note's own deck.</param>
/// <param name="Reviews">What the collection's review log holds against this one row.</param>
internal sealed record AnkiFixtureCardRow(
    int Ord,
    AnkiFixtureScheduling? Scheduling = null,
    string? DeckName = null,
    IReadOnlyList<AnkiFixtureReview>? Reviews = null);

/// <summary>
/// One note in a fixture package, and the deck it belongs to. <paramref name="ExtraFields"/> stands
/// in for a note type that carries more than the two sides a card here has room for,
/// <paramref name="NoteType"/> for one whose templates decide what each card shows, and
/// <paramref name="CardRows"/> for a note whose rows are written out one by one.
/// </summary>
internal sealed record AnkiFixtureCard(
    string DeckName,
    string FrontHtml,
    string BackHtml,
    string Tags = "",
    IReadOnlyList<string>? ExtraFields = null,
    AnkiFixtureScheduling? Scheduling = null,
    AnkiFixtureNoteType? NoteType = null,
    IReadOnlyList<AnkiFixtureCardRow>? CardRows = null,
    IReadOnlyList<AnkiFixtureReview>? Reviews = null);

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

    /// <summary>
    /// When the fixture collection was made, in the seconds Anki's <c>col.crt</c> holds. A review
    /// card's due value is counted in whole days from here, so tests need the same anchor.
    /// </summary>
    public const long CollectionCreatedAtUnixSeconds = 1_600_000_000L;

    public static DateTimeOffset CollectionCreatedAt => DateTimeOffset.FromUnixTimeSeconds(CollectionCreatedAtUnixSeconds);

    /// <summary>
    /// A fresh directory for the media an import materialises. Handing one to the image asset
    /// service keeps a test's attachments in a directory it owns, rather than in the profile an
    /// installed app reads, which is where the service resolves them when nobody says otherwise.
    /// </summary>
    public static string NewImagesDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"mnemo-tests-anki-images-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        return directory;
    }

    private const long FirstDeckId = 1500000000001L;
    private const long BasicNotetypeId = 1608194021001L;
    private const string BasicNotetypeName = "Basic";

    /// <summary>The id a fixture gives a deck, so a card can point at one it is not filed under.</summary>
    public static long DeckIdFor(IReadOnlyList<AnkiFixtureCard> cards, string deckName)
    {
        var index = DeckNames(cards).IndexOf(deckName);
        if (index < 0)
            throw new ArgumentException($"No fixture deck named '{deckName}'.", nameof(deckName));
        return FirstDeckId + index;
    }

    /// <summary>Every deck a set of fixture notes mentions, in the order the ids are handed out.</summary>
    private static List<string> DeckNames(IReadOnlyList<AnkiFixtureCard> cards)
    {
        var seen = new List<string>();
        foreach (var card in cards)
        {
            foreach (var name in new[] { card.DeckName }.Concat(
                card.CardRows?.Select(r => r.DeckName ?? card.DeckName) ?? []))
            {
                if (!seen.Contains(name, StringComparer.Ordinal))
                    seen.Add(name);
            }
        }

        return seen;
    }

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
            // No pool to clear: WriteCollectionAsync opens the collection with Pooling=False, so
            // disposing its connection has already released the file this is about to zip.
            await WriteCollectionAsync(collectionPath, layout, cards).ConfigureAwait(false);

            if (layout == AnkiFixtureLayout.Legacy)
                WriteLegacyPackage(packagePath, collectionPath, media);
            else
                await WriteModernPackageAsync(packagePath, collectionPath, workRoot, media).ConfigureAwait(false);

            return packagePath;
        }
        finally
        {
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
            CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, usn INTEGER, ease INTEGER,
                ivl INTEGER, lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER);
            """).ConfigureAwait(false);

        var deckIds = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var name in DeckNames(cards))
            deckIds[name] = FirstDeckId + deckIds.Count;

        if (layout == AnkiFixtureLayout.Legacy)
        {
            await WriteLegacyNameColumnsAsync(connection, deckIds, cards).ConfigureAwait(false);
        }
        else
        {
            await WriteModernNameTablesAsync(connection, deckIds, cards).ConfigureAwait(false);
        }

        var noteId = 100L;
        var cardId = 200L;
        var usedReviewIds = new HashSet<long>();
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
                ("@mid", card.NoteType?.Id ?? BasicNotetypeId),
                ("@tags", card.Tags),
                ("@flds", fields)).ConfigureAwait(false);

            // A note makes one card per template, and the ordinal is how a card row says which of
            // them it stands for. A note with no note type declared makes the single card the
            // fixture has always written, and one that lists its rows outright gets exactly those.
            var rows = card.CardRows is { Count: > 0 } listed
                ? listed
                : (card.NoteType is { Templates.Count: > 0 } noteType
                    ? [.. Enumerable.Range(0, noteType.Templates.Count).Select(ord => new AnkiFixtureCardRow(ord))]
                    : new AnkiFixtureCardRow[] { new(0) });

            foreach (var row in rows)
            {
                var scheduling = row.Scheduling ?? card.Scheduling ?? new AnkiFixtureScheduling();
                await ExecAsync(
                    connection,
                    "INSERT INTO cards(id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data) " +
                    "VALUES(@id, @nid, @did, @ord, 0, 0, @type, @queue, @due, @ivl, 2500, @reps, @lapses, 0, @odue, @odid, 0, '');",
                    ("@id", cardId),
                    ("@nid", noteId),
                    ("@did", deckIds[row.DeckName ?? card.DeckName]),
                    ("@ord", row.Ord),
                    ("@type", scheduling.Type),
                    ("@queue", scheduling.Queue),
                    ("@due", scheduling.Due),
                    ("@ivl", scheduling.Interval),
                    ("@reps", scheduling.Reps),
                    ("@lapses", scheduling.Lapses),
                    ("@odue", scheduling.OriginalDue),
                    ("@odid", scheduling.OriginalDeckId)).ConfigureAwait(false);

                // A note that lists its rows carries its history per row, because each deletion was
                // answered separately. One written the short way carries the note's own list.
                var reviews = row.Reviews ?? (card.CardRows is { Count: > 0 } ? null : card.Reviews);
                foreach (var review in reviews ?? [])
                    await WriteReviewAsync(connection, usedReviewIds, cardId, review).ConfigureAwait(false);

                cardId++;
            }

            noteId++;
        }
    }

    /// <summary>
    /// Writes one answer into the collection's review log. The row's key is the instant it was
    /// given, which is what the real table uses, so a second answer in the same millisecond takes
    /// the next free key rather than replacing the first.
    /// </summary>
    private static async Task WriteReviewAsync(
        SqliteConnection connection, HashSet<long> usedIds, long cardId, AnkiFixtureReview review)
    {
        var id = review.At.ToUnixTimeMilliseconds();
        while (!usedIds.Add(id))
            id++;

        await ExecAsync(
            connection,
            "INSERT INTO revlog(id,cid,usn,ease,ivl,lastIvl,factor,time,type) " +
            "VALUES(@id, @cid, 0, @ease, @ivl, @lastIvl, 2500, 8000, @type);",
            ("@id", id),
            ("@cid", cardId),
            ("@ease", review.Ease),
            ("@ivl", review.Interval),
            ("@lastIvl", review.LastInterval),
            ("@type", review.Type)).ConfigureAwait(false);
    }

    /// <summary>The note types a set of fixture notes is written under, first use winning.</summary>
    private static List<AnkiFixtureNoteType> DeclaredNoteTypes(IReadOnlyList<AnkiFixtureCard> cards)
    {
        var declared = new List<AnkiFixtureNoteType>();
        foreach (var card in cards)
        {
            if (card.NoteType is { } noteType && !declared.Exists(t => t.Id == noteType.Id))
                declared.Add(noteType);
        }

        return declared;
    }

    /// <summary>
    /// One note type as the legacy models column holds it: ordered field and template names, and
    /// the format strings a card is rendered through.
    /// </summary>
    private static Dictionary<string, object?> ModelJson(AnkiFixtureNoteType noteType)
    {
        var fields = new List<object?>();
        for (var i = 0; i < noteType.FieldNames.Count; i++)
            fields.Add(new Dictionary<string, object?> { ["name"] = noteType.FieldNames[i], ["ord"] = i });

        var templates = new List<object?>();
        for (var i = 0; i < noteType.Templates.Count; i++)
        {
            var template = noteType.Templates[i];
            templates.Add(new Dictionary<string, object?>
            {
                ["name"] = template.Name,
                ["ord"] = i,
                ["qfmt"] = template.QuestionFormat,
                ["afmt"] = template.AnswerFormat,
            });
        }

        return new Dictionary<string, object?>
        {
            ["id"] = noteType.Id,
            ["name"] = noteType.Name,
            ["type"] = noteType.IsCloze ? 1 : 0,
            ["flds"] = fields,
            ["tmpls"] = templates,
        };
    }

    private static async Task WriteLegacyNameColumnsAsync(
        SqliteConnection connection,
        IReadOnlyDictionary<string, long> deckIds,
        IReadOnlyList<AnkiFixtureCard> cards)
    {
        var decks = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (name, id) in deckIds)
            decks[id.ToString(CultureInfo.InvariantCulture)] = new Dictionary<string, object?> { ["id"] = id, ["name"] = name };

        var models = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [BasicNotetypeId.ToString(CultureInfo.InvariantCulture)] =
                new Dictionary<string, object?> { ["id"] = BasicNotetypeId, ["name"] = BasicNotetypeName }
        };

        foreach (var noteType in DeclaredNoteTypes(cards))
            models[noteType.Id.ToString(CultureInfo.InvariantCulture)] = ModelJson(noteType);

        await ExecAsync(
            connection,
            "INSERT INTO col(id,crt,mod,scm,ver,dty,usn,ls,conf,models,decks,dconf,tags) " +
            "VALUES(1, @crt, 0, 0, 11, 0, 0, 0, '{}', @models, @decks, '{}', '{}');",
            ("@crt", CollectionCreatedAtUnixSeconds),
            ("@models", JsonSerializer.Serialize(models)),
            ("@decks", JsonSerializer.Serialize(decks))).ConfigureAwait(false);
    }

    /// <summary>
    /// The current schema keeps the two name columns present but empty and moves the names into
    /// tables of their own, with a unit separator between the levels of a deck's hierarchy.
    /// </summary>
    private static async Task WriteModernNameTablesAsync(
        SqliteConnection connection,
        IReadOnlyDictionary<string, long> deckIds,
        IReadOnlyList<AnkiFixtureCard> cards)
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
            "VALUES(1, @crt, 0, 0, 18, 0, 0, 0, '{}', '', '', '{}', '{}');",
            ("@crt", CollectionCreatedAtUnixSeconds)).ConfigureAwait(false);

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

        // The current layout keeps a note type's fields and templates in an encoded config rather
        // than as text, so only the name is written here and a reader gets no templates from it.
        foreach (var noteType in DeclaredNoteTypes(cards))
        {
            if (noteType.Id == BasicNotetypeId)
                continue;
            await ExecAsync(
                connection,
                "INSERT INTO notetypes(id,name,mtime_secs,usn,config) VALUES(@id, @name, 0, 0, x'');",
                ("@id", noteType.Id),
                ("@name", noteType.Name)).ConfigureAwait(false);
        }
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
