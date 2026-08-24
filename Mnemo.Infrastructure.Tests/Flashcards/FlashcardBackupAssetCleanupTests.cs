using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// What a replacing import does to the files of the content it destroys.
/// </summary>
/// <remarks>
/// A replace is the one import that deletes rows outright, which makes it a delete path like any
/// other: it may not remove a file itself, because a picture is shared between a piece of material
/// and every card that material makes, and it may not walk away from one either, because a file
/// whose last row is gone and that nobody wrote down is a leak nothing will ever find. Every other
/// delete path in the collection queues the paths it orphaned and lets the cleanup pass decide, and
/// this one has to do the same.
/// </remarks>
public sealed class FlashcardBackupAssetCleanupTests
{
    /// <summary>
    /// The directory this class treats as the managed image store. Owned here rather than
    /// resolved from the data root, so the paths these tests build never point into the profile
    /// an installed app reads.
    /// </summary>
    private static readonly string ImagesDirectory = FlashcardPackageFixture.NewImagesDirectory();

    private static readonly DateTimeOffset Now = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Replacing_a_deck_queues_the_files_of_the_material_it_destroys()
    {
        await using var h = await OpenAsync();

        // Taken before the material exists, so restoring it is a genuine deletion of that material.
        var package = await FlashcardPackageFixture.Handler(h, ImagesDirectory).ExportAsync(FlashcardPackageFixture.ExportContext());

        var path = ManagedPath("destroyed.png");
        var saved = await h.FactService.SaveFactAsync(Draft(new() { ["front"] = "Q", ["back"] = "A" }, MediaOn("front", path)));
        Assert.Single(saved.Cards);

        await FlashcardPackageFixture.Handler(h, ImagesDirectory)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, ImportConflictPolicy.Replace));

        Assert.Null(await h.FactService.GetFactAsync(saved.Fact.Id));
        Assert.Contains(path, await QueuedAsync(h));
    }

    [Fact]
    public async Task Replacing_a_deck_queues_the_files_of_the_cards_it_destroys()
    {
        await using var h = await OpenAsync();
        var package = await FlashcardPackageFixture.Handler(h, ImagesDirectory).ExportAsync(FlashcardPackageFixture.ExportContext());

        // A card with no material of its own owns its file outright, so nothing else can speak for it.
        var path = ManagedPath("freeform.png");
        var card = new Flashcard(
            Id: Guid.NewGuid().ToString("N"), DeckId: "deck-1", Type: FlashcardType.Classic,
            Front: "Q", Back: "A", Tags: [], State: FlashcardCardState.Active, IsFlagged: false,
            Attachments: [Attachment("a1", path)], CreatedAt: Now, UpdatedAt: Now);
        await h.AddCardAsync(card, FlashcardSchedule.NewFor(card.Id, Now));

        await FlashcardPackageFixture.Handler(h, ImagesDirectory)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, ImportConflictPolicy.Replace));

        Assert.Contains(path, await QueuedAsync(h));
    }

    /// <summary>
    /// Restoring a backup of this very collection destroys rows and immediately writes rows naming
    /// the same files back. Queueing those paths is correct and harmless, because the cleanup pass
    /// asks the collection whether anything still names a file before removing it, and by then the
    /// restored rows do. The file that is genuinely gone is the only one it can act on.
    /// </summary>
    [Fact]
    public async Task Replacing_with_the_same_package_leaves_the_files_it_puts_back_alone()
    {
        await using var h = await OpenAsync();

        var kept = ManagedPath("kept.png");
        await h.FactService.SaveFactAsync(Draft(new() { ["front"] = "Q", ["back"] = "A" }, MediaOn("front", kept)));

        var package = await FlashcardPackageFixture.Handler(h, ImagesDirectory).ExportAsync(FlashcardPackageFixture.ExportContext());

        // Written after the backup was taken, so the replace destroys it for good.
        var orphaned = ManagedPath("orphaned.png");
        await h.FactService.SaveFactAsync(Draft(new() { ["front"] = "Later", ["back"] = "Gone" }, MediaOn("front", orphaned)));

        await FlashcardPackageFixture.Handler(h, ImagesDirectory)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, ImportConflictPolicy.Replace));

        var queued = await QueuedAsync(h);
        Assert.Contains(orphaned, queued);

        // This is the question the cleanup pass puts to the collection for each queued path, and
        // the answer is what decides whether the file is removed or kept.
        var referenced = await FlashcardAssetReferences.CollectReferencedPathsAsync(h.Store);
        Assert.True(FlashcardAssetReferences.Contains(referenced, kept), "the restored material still names its picture");
        Assert.False(FlashcardAssetReferences.Contains(referenced, orphaned), "nothing names the destroyed material's picture");
    }

    /// <summary>
    /// The search index is kept in step by a delete trigger, and a foreign key cascade does not fire
    /// one, so a clear that let material take its cards away instead of deleting them itself would
    /// leave the index describing rows that are gone.
    /// </summary>
    [Fact]
    public async Task Replacing_a_deck_leaves_the_search_index_agreeing_with_the_cards()
    {
        await using var h = await OpenAsync();
        var package = await FlashcardPackageFixture.Handler(h, ImagesDirectory).ExportAsync(FlashcardPackageFixture.ExportContext());

        await h.FactService.SaveFactAsync(Draft(new() { ["front"] = "Vanishing", ["back"] = "Gone" }, null));

        await FlashcardPackageFixture.Handler(h, ImagesDirectory)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, ImportConflictPolicy.Replace));

        await IntegrityCheckAsync(h);
    }

    // ---- Plumbing ------------------------------------------------------------------------------

    private static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    /// <summary>
    /// The paths waiting in the cleanup queue. Nothing enqueued yet means no table yet, which reads
    /// the same as an empty queue.
    /// </summary>
    private static Task<List<string>> QueuedAsync(FlashcardStoreHarness harness) =>
        harness.Store.ReadAsync(async (conn, ct) =>
        {
            var paths = new List<string>();

            await using var exists = conn.CreateCommand();
            exists.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'AssetCleanupJobs';";
            if (await exists.ExecuteScalarAsync(ct) is null)
                return paths;

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Path FROM AssetCleanupJobs WHERE Owner = $owner;";
            cmd.Parameters.AddWithValue("$owner", FlashcardAssetReferences.AssetOwner);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                paths.Add(reader.GetString(0));
            return paths;
        });

    /// <summary>Asks fts5 whether its index still describes the cards that are actually there.</summary>
    private static Task IntegrityCheckAsync(FlashcardStoreHarness harness) =>
        harness.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "INSERT INTO FlashcardCardsFts(FlashcardCardsFts) VALUES('integrity-check');";
            await cmd.ExecuteNonQueryAsync(ct);
            return true;
        });

    private static string ManagedPath(string name) =>
        Path.Combine(ImagesDirectory, $"{Guid.NewGuid():N}-{name}");

    private static FlashcardAttachment Attachment(string id, string path) =>
        new(id, FlashcardAttachment.FrontSide, path, Path.GetFileName(path), 100);

    private static IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>>? MediaOn(string fieldId, string path) =>
        new Dictionary<string, IReadOnlyList<FlashcardAttachment>> { [fieldId] = [Attachment(Guid.NewGuid().ToString("N"), path)] };

    private static FlashcardFactDraft Draft(
        Dictionary<string, string> values,
        IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>>? media) =>
        new(null, "deck-1", FlashcardCardType.BasicId, values,
            media ?? new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(), []);
}
