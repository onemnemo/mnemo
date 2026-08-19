using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Covers the Anki (.apkg) image reroute: imported <c>&lt;img&gt;</c> tags become
/// <see cref="FlashcardAttachment"/>s (up to 3 per side; overflow appended as inline markdown tokens)
/// rather than image blocks. The canonical body is the text field and blocks carry no image payloads.
/// </summary>
public sealed class FlashcardAnkiImportTests
{
    private const char UnitSeparator = '';

    [Fact]
    public async Task Import_ImageInField_LandsAsAttachment_NotBlock()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        var apkg = await BuildApkgAsync(
            deckName: "Biology",
            frontHtml: "What is this? <img src=\"diagram.png\">",
            backHtml: "A cell",
            media: new Dictionary<string, byte[]> { ["diagram.png"] = new byte[128] });

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            var card = Assert.Single(page.Items).Card;

            var attachment = Assert.Single(card.Attachments);
            Assert.Equal(FlashcardAttachment.FrontSide, attachment.Side);
            Assert.Equal("diagram.png", attachment.DisplayName);
            Assert.True(attachment.SizeBytes > 0);
            Assert.True(File.Exists(attachment.FilePath));

            // No image blocks anywhere — the block pipeline is text-only now.
            var allBlocks = (card.FrontBlocks ?? Array.Empty<Block>())
                .Concat(card.BackBlocks ?? Array.Empty<Block>());
            Assert.DoesNotContain(allBlocks, b => b.Type == BlockType.Image);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_FourImagesOnOneSide_KeepsThreeAttachments_AndAppendsOverflowToken()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        var apkg = await BuildApkgAsync(
            deckName: "Overflow",
            frontHtml: "<img src=\"a.png\"><img src=\"b.png\"><img src=\"c.png\"><img src=\"d.png\">",
            backHtml: "back",
            media: new Dictionary<string, byte[]>
            {
                ["a.png"] = new byte[16],
                ["b.png"] = new byte[16],
                ["c.png"] = new byte[16],
                ["d.png"] = new byte[16]
            });

        try
        {
            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            Assert.True(result.Success, result.ErrorMessage);
            var deck = Assert.Single(await library.ListDecksAsync());
            var page = await cardSvc.ListCardsAsync(new FlashcardCardQuery(deck.Id));
            var card = Assert.Single(page.Items).Card;

            Assert.Equal(3, card.Attachments.Count);
            Assert.All(card.Attachments, a => Assert.Equal(FlashcardAttachment.FrontSide, a.Side));
            // The 4th image is kept visible as an inline markdown token, never dropped.
            Assert.Contains("![d.png](", card.Front, StringComparison.Ordinal);
            Assert.Contains(result.Warnings, w => w.Contains("exceeded", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_MissingCollectionDatabase_CleansUpExtractedTempDirectory()
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules);
        var presetSvc = new FlashcardPresetService(h.Store, h.Presets, h.Decks);
        var adapter = new FlashcardsAnkiFormatAdapter(library, cardSvc, presetSvc, new ImageAssetService());

        // A .apkg with no collection.anki21/anki2 fails after the temp directory is already
        // extracted; both call sites must still remove it rather than leaking it in %TEMP%.
        var apkg = await BuildBrokenApkgAsync();

        try
        {
            var before = LeftoverImportDirectories();

            var preview = await adapter.PreviewImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.False(preview.CanImport);

            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.False(result.Success);

            var after = LeftoverImportDirectories();
            Assert.Equal(before, after);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    // --- helpers ---

    private static HashSet<string> LeftoverImportDirectories() =>
        new(Directory.GetDirectories(Path.GetTempPath(), "mnemo-anki-import-*"), StringComparer.OrdinalIgnoreCase);

    /// <summary>Writes a .apkg zip containing no collection.anki21/anki2, for temp-cleanup coverage.</summary>
    private static async Task<string> BuildBrokenApkgAsync()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"mnemo_anki_broken_fixture_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempRoot);
        await File.WriteAllTextAsync(Path.Combine(tempRoot, "not-a-collection.txt"), "no database here");

        var apkgPath = Path.Combine(Path.GetTempPath(), $"mnemo_anki_broken_{Guid.NewGuid():N}.apkg");
        ZipFile.CreateFromDirectory(tempRoot, apkgPath, CompressionLevel.Optimal, includeBaseDirectory: false);
        try { Directory.Delete(tempRoot, recursive: true); } catch (IOException) { }
        return apkgPath;
    }

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Schedules, h.Reviews, h.DailyStats, h.Presets);

    /// <summary>
    /// Writes a minimal single-note, single-card Anki package (collection.anki2 + media map + files).
    /// </summary>
    private static async Task<string> BuildApkgAsync(
        string deckName,
        string frontHtml,
        string backHtml,
        IReadOnlyDictionary<string, byte[]> media)
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"mnemo_anki_fixture_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempRoot);

        var dbPath = Path.Combine(tempRoot, "collection.anki2");
        await using (var conn = new SqliteConnection($"Data Source={dbPath};Pooling=False"))
        {
            await conn.OpenAsync();
            await ExecAsync(conn, """
                CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER,
                    dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT);
                CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER,
                    tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT);
                CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER,
                    usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER,
                    reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT);
                """);

            const long did = 1500000000001L;
            const long mid = 1608194021001L;
            var decksJson = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                [did.ToString(CultureInfo.InvariantCulture)] = new Dictionary<string, object?> { ["id"] = did, ["name"] = deckName }
            });
            var modelsJson = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                [mid.ToString(CultureInfo.InvariantCulture)] = new Dictionary<string, object?> { ["id"] = mid, ["name"] = "Basic" }
            });

            await ExecAsync(conn,
                "INSERT INTO col(id,crt,mod,scm,ver,dty,usn,ls,conf,models,decks,dconf,tags) " +
                "VALUES(1, 0, 0, 0, 11, 0, 0, 0, '{}', @models, @decks, '{}', '{}');",
                ("@models", modelsJson), ("@decks", decksJson));

            var flds = $"{frontHtml}{UnitSeparator}{backHtml}";
            await ExecAsync(conn,
                "INSERT INTO notes(id,guid,mid,mod,usn,tags,flds,sfld,csum,flags,data) " +
                "VALUES(100, 'g', @mid, 0, 0, '', @flds, '', 0, 0, '');",
                ("@mid", mid), ("@flds", flds));
            await ExecAsync(conn,
                "INSERT INTO cards(id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data) " +
                "VALUES(200, 100, @did, 0, 0, 0, 0, 0, 0, 0, 2500, 0, 0, 0, 0, 0, 0, '');",
                ("@did", did));
        }
        SqliteConnection.ClearAllPools();

        // Anki media map: numbered files on disk, original names in the JSON.
        var mediaMap = new Dictionary<string, string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var (name, bytes) in media)
        {
            var slot = index.ToString(CultureInfo.InvariantCulture);
            await File.WriteAllBytesAsync(Path.Combine(tempRoot, slot), bytes);
            mediaMap[slot] = name;
            index++;
        }
        await File.WriteAllTextAsync(Path.Combine(tempRoot, "media"), JsonSerializer.Serialize(mediaMap));

        var apkgPath = Path.Combine(Path.GetTempPath(), $"mnemo_anki_{Guid.NewGuid():N}.apkg");
        ZipFile.CreateFromDirectory(tempRoot, apkgPath, CompressionLevel.Optimal, includeBaseDirectory: false);
        try { Directory.Delete(tempRoot, recursive: true); } catch (IOException) { }
        return apkgPath;
    }

    private static async Task ExecAsync(SqliteConnection conn, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value);
        await cmd.ExecuteNonQueryAsync();
    }
}
