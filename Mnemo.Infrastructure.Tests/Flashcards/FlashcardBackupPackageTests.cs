using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// What a <c>.mnemo</c> backup has to be worth: everything a collection holds, put back exactly
/// where it was.
/// </summary>
/// <remarks>
/// The question every test here asks is whether identity survived. A restore that mints fresh ids
/// hands somebody a copy of their collection rather than their collection, and the difference only
/// shows up later, when their cloze cards have lost the material behind them and their decks are
/// scheduled by a profile they never chose.
/// </remarks>
public sealed class FlashcardBackupPackageTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task A_backup_puts_a_whole_collection_back_with_its_own_ids()
    {
        await using var source = await SeededCollectionAsync();
        var original = await ReadCollectionAsync(source);

        var package = await FlashcardPackageFixture.Handler(source).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        var result = await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        Assert.Equal(1, result.ImportedCount);
        var restored = await ReadCollectionAsync(target);
        Assert.Equal(original, restored);
    }

    [Fact]
    public async Task A_cloze_card_comes_back_still_made_of_the_material_it_was_made_of()
    {
        await using var source = await SeededCollectionAsync();
        var sourceCards = await ClozeCardsAsync(source);
        Assert.Equal(2, sourceCards.Count);

        var package = await FlashcardPackageFixture.Handler(source).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var restored = await ClozeCardsAsync(target);
        Assert.Equal(2, restored.Count);
        // One fact behind both cards, the same fact id the source had, and each card still knows
        // which deletion it asks. Without FactId and LayoutKey in the payload these come back as
        // two unrelated freeform cards and the material behind them is gone.
        Assert.Single(restored.Select(c => c.FactId).Distinct(StringComparer.Ordinal));
        Assert.Equal(
            sourceCards.Select(c => c.FactId).Distinct(StringComparer.Ordinal),
            restored.Select(c => c.FactId).Distinct(StringComparer.Ordinal));
        Assert.Equal(
            sourceCards.Select(c => c.LayoutKey).Order(StringComparer.Ordinal),
            restored.Select(c => c.LayoutKey).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task A_backup_carries_the_scheduling_profile_the_deck_was_studied_under()
    {
        await using var source = await SeededCollectionAsync();

        var package = await FlashcardPackageFixture.Handler(source).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var deck = Assert.Single(await LibraryOf(target).ListDecksAsync());
        Assert.Equal("preset-intense", deck.Header.PresetId);
        var preset = await target.Store.ReadAsync((conn, ct) => target.Presets.GetAsync(conn, "preset-intense", ct));
        Assert.NotNull(preset);
        Assert.Equal(60, preset!.NewPerDay);
        Assert.Equal(0.95, preset.DesiredRetention);
        Assert.Equal(3, preset.LeechThreshold);
        Assert.Equal(FlashcardLeechAction.Suspend, preset.LeechAction);
    }

    [Fact]
    public async Task A_backup_carries_the_card_type_its_material_is_filled_into()
    {
        await using var source = await SeededCollectionAsync();

        var package = await FlashcardPackageFixture.Handler(source).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var custom = await target.Store.ReadAsync((conn, ct) => target.CardTypes.GetAsync(conn, "type-terms", ct));
        Assert.NotNull(custom);
        Assert.Equal("Terms", custom!.Name);
        Assert.Equal(2, custom.Layouts.Count);
        Assert.Contains(custom.Fields, f => f.Id == "term" && f.Name == "Term");
    }

    [Fact]
    public async Task A_backup_carries_the_review_history_and_the_daily_counters()
    {
        await using var source = await SeededCollectionAsync();

        var package = await FlashcardPackageFixture.Handler(source).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var reviews = await target.Store.ReadAsync((conn, ct) => target.Reviews.ListAllForDeckAsync(conn, "deck-1", ct));
        Assert.Equal(2, reviews.Count);
        Assert.Equal(FlashcardReviewGrade.Good, reviews[0].Grade);
        Assert.Equal(FlashcardReviewGrade.Again, reviews[1].Grade);
        Assert.Equal(FlashcardFsrsState.Review, reviews[0].StateBefore);

        var stats = await target.Store.ReadAsync((conn, ct) => target.DailyStats.ListAllForDeckAsync(conn, "deck-1", ct));
        var day = Assert.Single(stats);
        Assert.Equal("2026-03-03", day.Date);
        Assert.Equal(3, day.NewIntroduced);
        Assert.Equal(11, day.ReviewsDone);
    }

    /// <summary>
    /// History carried in from another app comes back still marked as carried in. A backup that
    /// drops the marker hands those answers back as though they had been sat through here, and
    /// nothing afterwards can tell the two apart again.
    /// </summary>
    [Fact]
    public async Task A_backup_keeps_imported_history_apart_from_history_answered_here()
    {
        await using var source = await SeededCollectionAsync();
        var importedSession = FlashcardImportedReviews.NewSessionId();
        var studiedCardId = (await source.Store.ReadAsync(
            (conn, ct) => source.Reviews.ListAllForDeckAsync(conn, "deck-1", ct)))[0].CardId;
        await source.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await source.Reviews.AppendAsync(conn, tx, new FlashcardReviewLog(
                FlashcardReviewLog.Unassigned, studiedCardId, "deck-1", importedSession, FlashcardReviewGrade.Hard,
                Now.AddDays(-5), 2.0, 4.0, 18.0, 5.5, FlashcardFsrsState.Review, FlashcardFsrsState.Review,
                FlashcardReviewOrigin.Imported), ct);
        });

        var package = await FlashcardPackageFixture.Handler(source).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var restored = await target.Store.ReadAsync((conn, ct) => target.Reviews.ListAllForDeckAsync(conn, "deck-1", ct));
        Assert.Equal(3, restored.Count);
        Assert.Equal(["session-1", "session-2", importedSession], restored.Select(r => r.SessionId));
        Assert.Equal(FlashcardReviewOrigin.Studied, restored[0].Origin);
        Assert.Equal(FlashcardReviewOrigin.Studied, restored[1].Origin);
        Assert.Equal(FlashcardReviewOrigin.Imported, restored[2].Origin);
        Assert.Equal(FlashcardReviewGrade.Hard, restored[2].Grade);
    }

    /// <summary>
    /// A package written before a review said where it came from carries no marker at all, and the
    /// honest reading of that silence is that the answer was given here, which is what every row in
    /// such a package was.
    /// </summary>
    [Fact]
    public async Task A_review_with_no_recorded_origin_comes_back_as_answered_here()
    {
        var exported = new MnemoPayloadExportData
        {
            ItemCount = 1,
            SchemaVersion = 3,
            Files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase)
            {
                ["flashcards.db"] = PayloadWithoutReviewOriginBytes(),
            },
        };

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        var result = await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(exported));

        Assert.Equal(1, result.ImportedCount);
        var review = Assert.Single(await target.Store.ReadAsync(
            (conn, ct) => target.Reviews.ListAllForDeckAsync(conn, "deck-before-origins", ct)));
        Assert.Equal(FlashcardReviewOrigin.Studied, review.Origin);
        Assert.Equal(FlashcardReviewGrade.Good, review.Grade);
        Assert.Equal("session-old", review.SessionId);
    }

    /// <summary>
    /// A package somebody means to hand on carries the content and none of the reader's own record
    /// of answering it. Otherwise a shared deck lands in the recipient's retention figures and in
    /// the training data their scheduler fits its parameters from.
    /// </summary>
    [Fact]
    public async Task An_export_carries_the_material_but_not_how_its_author_answered_it()
    {
        await using var source = await SeededCollectionAsync();

        var package = await FlashcardPackageFixture.Handler(source)
            .ExportAsync(FlashcardPackageFixture.ExportContext(MnemoPackageKinds.Export));

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        Assert.Empty(await target.Store.ReadAsync((conn, ct) => target.Reviews.ListAllForDeckAsync(conn, "deck-1", ct)));
        Assert.Empty(await target.Store.ReadAsync((conn, ct) => target.DailyStats.ListAllForDeckAsync(conn, "deck-1", ct)));
        // The material itself still travels, or the cloze cards would arrive with nothing behind them.
        Assert.Equal(2, (await ClozeCardsAsync(target)).Count);
    }

    [Fact]
    public async Task Replacing_with_the_same_backup_lands_the_same_collection_rather_than_a_second_copy()
    {
        await using var h = await SeededCollectionAsync();
        var before = await ReadCollectionAsync(h);
        var package = await FlashcardPackageFixture.Handler(h).ExportAsync(FlashcardPackageFixture.ExportContext());

        var first = await FlashcardPackageFixture.Handler(h)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, ImportConflictPolicy.Replace));
        var second = await FlashcardPackageFixture.Handler(h)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, ImportConflictPolicy.Replace));

        Assert.Equal(1, first.ImportedCount);
        Assert.Equal(1, second.ImportedCount);
        Assert.Equal(0, first.DuplicatedCount);
        Assert.Equal(0, second.DuplicatedCount);
        Assert.Equal(before, await ReadCollectionAsync(h));
    }

    [Fact]
    public async Task Replacing_a_deck_takes_out_the_cards_the_package_does_not_carry()
    {
        await using var h = await SeededCollectionAsync();
        var package = await FlashcardPackageFixture.Handler(h).ExportAsync(FlashcardPackageFixture.ExportContext());

        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        await cards.CreateCardsAsync("deck-1", new[]
        {
            new FlashcardCardDraft("deck-1", FlashcardType.Classic, "written after the backup", "gone", [], []),
        });

        await FlashcardPackageFixture.Handler(h)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, ImportConflictPolicy.Replace));

        var page = await cards.ListCardsAsync(new FlashcardCardQuery("deck-1", Limit: 200));
        Assert.DoesNotContain(page.Items, view => view.Card.Front == "written after the backup");
    }

    /// <summary>
    /// Replace imports must preserve decks absent from the package, including their cards.
    /// </summary>
    [Fact]
    public async Task Replacing_leaves_a_deck_the_package_never_carried_alone()
    {
        await using var h = await SeededCollectionAsync();
        var package = await FlashcardPackageFixture.Handler(h).ExportAsync(FlashcardPackageFixture.ExportContext());

        var library = LibraryOf(h);
        var foreignDeck = await library.CreateDeckAsync("Not in the package");
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        await cards.CreateCardsAsync(foreignDeck.Id, new[]
        {
            new FlashcardCardDraft(foreignDeck.Id, FlashcardType.Classic, "outside the package", "still here", [], []),
        });
        var before = await ReadDeckAsync(h, foreignDeck.Id);

        var result = await FlashcardPackageFixture.Handler(h)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, ImportConflictPolicy.Replace));

        // Asserted before the survival check, which an import that quietly did nothing would also
        // satisfy.
        Assert.Equal(1, result.ImportedCount);
        var decks = await library.ListDecksAsync();
        Assert.Contains(decks, d => d.Id == foreignDeck.Id);
        Assert.Equal(before, await ReadDeckAsync(h, foreignDeck.Id));
    }

    /// <summary>
    /// Keeping both is what an import into a collection that already has this content does by
    /// default, and it must never overwrite what is there or leave two cards fighting over one
    /// layout of the same material.
    /// </summary>
    [Fact]
    public async Task Keeping_both_copies_a_collection_beside_itself_without_touching_the_original()
    {
        await using var h = await SeededCollectionAsync();
        var before = await ReadCollectionAsync(h);
        var package = await FlashcardPackageFixture.Handler(h).ExportAsync(FlashcardPackageFixture.ExportContext());

        var result = await FlashcardPackageFixture.Handler(h)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, ImportConflictPolicy.KeepBoth));

        Assert.Equal(1, result.ImportedCount);
        var decks = await LibraryOf(h).ListDecksAsync();
        Assert.Equal(2, decks.Count);
        Assert.Contains(decks, d => d.Id == "deck-1");
        var original = await ReadDeckAsync(h, "deck-1");
        Assert.Equal(before, original);
    }

    [Fact]
    public async Task A_package_from_a_newer_build_is_refused_with_a_warning_the_reader_can_read()
    {
        await using var h = await SeededCollectionAsync();
        var package = await FlashcardPackageFixture.Handler(h).ExportAsync(FlashcardPackageFixture.ExportContext());

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        var result = await FlashcardPackageFixture.Handler(target)
            .ImportAsync(FlashcardPackageFixture.ImportContext(package, schemaVersion: package.SchemaVersion + 1));

        Assert.Equal(0, result.ImportedCount);
        var warning = Assert.Single(result.Warnings);
        Assert.Equal("FlashcardsPackageTooNew", warning.Key);
        Assert.Equal((package.SchemaVersion + 1).ToString(), warning.Params["packageVersion"]);
        Assert.Equal(package.SchemaVersion.ToString(), warning.Params["supportedVersion"]);
        Assert.Empty(await LibraryOf(target).ListDecksAsync());
    }

    /// <summary>
    /// The layout every shipped package before this one is in. Its database has only the two
    /// original tables, so reading it has to survive the absence of everything added since.
    /// </summary>
    [Fact]
    public async Task A_package_in_the_previous_format_still_imports()
    {
        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["flashcards.db"] = LegacyPayloadBytes(),
        };
        var exported = new MnemoPayloadExportData { ItemCount = 1, SchemaVersion = 2, Files = files };

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        var result = await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(exported));

        Assert.Equal(1, result.ImportedCount);
        var deck = Assert.Single(await LibraryOf(target).ListDecksAsync());
        Assert.Equal("Legacy", deck.Name);
        // Nothing in the old format names a profile, so the deck lands on the shared standard one
        // rather than on a reference the deck table would refuse.
        Assert.Equal(FlashcardPreset.StandardPresetId, deck.Header.PresetId);

        var cards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);
        var page = await cards.ListCardsAsync(new FlashcardCardQuery("legacy-deck"));
        var view = Assert.Single(page.Items);
        Assert.Equal("Old question", view.Card.Front);
        Assert.Equal(FlashcardFsrsState.Review, view.Schedule.FsrsState);
    }

    /// <summary>
    /// Material and the layout it was rendered through are one fact about a card, and a package is
    /// a file somebody can edit. A card naming material with no layout would sit outside the unique
    /// index that reserves one card per layout, and the material would not count it among the cards
    /// it has made, which is what decides whether that material is an orphan worth destroying.
    /// </summary>
    [Fact]
    public async Task A_card_naming_material_with_no_layout_lands_as_a_card_of_its_own()
    {
        var snapshot = new FlashcardPayloadSnapshot();
        snapshot.Facts.Add(new FactSnapshotDto
        {
            Id = "fact-1",
            DeckId = "deck-9",
            TypeId = FlashcardCardType.BasicId,
            Values = new Dictionary<string, string> { ["front"] = "Q", ["back"] = "A" },
        });
        snapshot.Decks.Add(new DeckSnapshotDto
        {
            Id = "deck-9",
            Name = "Hand edited",
            Cards =
            [
                new CardSnapshotDto { Id = "card-1", DeckId = "deck-9", Front = "Q", Back = "A", FactId = "fact-1" },
            ],
        });

        var exported = new MnemoPayloadExportData
        {
            ItemCount = 1,
            SchemaVersion = 3,
            Files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase)
            {
                ["flashcards.db"] = FlashcardPayloadDatabase.Write(snapshot),
            },
        };

        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        var result = await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(exported));

        Assert.Equal(1, result.ImportedCount);
        var card = await target.Store.ReadAsync((conn, ct) => target.Cards.GetAsync(conn, "card-1", ct));
        Assert.NotNull(card);
        Assert.Null(card!.FactId);
        Assert.Null(card.LayoutKey);
    }

    [Fact]
    public async Task Opening_a_package_says_what_is_already_here_and_what_replacing_would_destroy()
    {
        await using var source = await SeededCollectionAsync();
        var package = await FlashcardPackageFixture.Handler(source).ExportAsync(FlashcardPackageFixture.ExportContext());

        // The collection the backup is being opened against is the one it was taken from, which is
        // the case the dialog exists for. Two things have happened since: a card was written, and a
        // deck was made that the file has never heard of.
        await using var target = new FlashcardStoreHarness(Now);
        await target.Store.InitializeAsync();
        await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(package));

        var cards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);
        await cards.CreateCardsAsync("deck-1", new[]
        {
            new FlashcardCardDraft("deck-1", FlashcardType.Classic, "only here", "gone on replace", [], []),
        });
        await LibraryOf(target).CreateDeckAsync("Not in the package");

        var evidence = await FlashcardPackageFixture.Handler(target)
            .InspectAsync(FlashcardPackageFixture.ImportContext(package));

        Assert.True(evidence.CanRead);
        Assert.Equal(1, evidence.InPackage);
        Assert.Equal(1, evidence.AlreadyHere);
        Assert.Equal(0, evidence.NewHere);
        Assert.Equal(1, evidence.MissingFromPackage);
        // Only the card written after the backup: the four the file carries come back, and the deck
        // it never had is not the replace's to touch.
        Assert.Equal(1, evidence.ReplaceWouldDiscard);
    }

    [Fact]
    public async Task Opening_a_package_from_a_newer_build_counts_nothing_and_says_why()
    {
        await using var h = await SeededCollectionAsync();
        var package = await FlashcardPackageFixture.Handler(h).ExportAsync(FlashcardPackageFixture.ExportContext());

        var evidence = await FlashcardPackageFixture.Handler(h)
            .InspectAsync(FlashcardPackageFixture.ImportContext(package, schemaVersion: package.SchemaVersion + 1));

        Assert.False(evidence.CanRead);
        Assert.Equal(package.SchemaVersion + 1, evidence.PayloadVersion);
        Assert.Equal(package.SchemaVersion, evidence.SupportedPayloadVersion);
        Assert.Equal(0, evidence.InPackage);
    }

    // ---- The collection every test above works from ------------------------------------------

    /// <summary>
    /// One deck under a custom profile, holding material of a custom card type and a cloze fact
    /// with two deletions, with review history and a day's counters behind it.
    /// </summary>
    private static async Task<FlashcardStoreHarness> SeededCollectionAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.Store.InitializeAsync();

        await harness.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await harness.Presets.UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(Now) with
            {
                Id = "preset-intense",
                Name = "Intense",
                NewPerDay = 60,
                DesiredRetention = 0.95,
                LeechThreshold = 3,
                LeechAction = FlashcardLeechAction.Suspend,
                Weights = new[] { 0.4, 1.1, 3.2 },
            }, ct);
            await harness.Decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                "deck-1", null, "preset-intense", "Pharmacology", "Second year", ["exam"], 0, Now.AddDays(-1),
                null, Now.AddDays(-30), Now.AddDays(-1)), ct);
            await harness.CardTypes.UpsertAsync(conn, tx, new FlashcardCardType(
                Id: "type-terms",
                Name: "Terms",
                IsBuiltIn: false,
                Fields: [new FlashcardField("term", "Term"), new FlashcardField("meaning", "Meaning")],
                SortFieldId: "term",
                Layouts:
                [
                    new FlashcardLayout("recognition", "Recognition", "{{Term}}", "{{Meaning}}"),
                    new FlashcardLayout("recall", "Recall", "{{Meaning}}", "{{Term}}"),
                ],
                CreatedAt: Now.AddDays(-30),
                UpdatedAt: Now.AddDays(-30)), ct);
        });

        var terms = await harness.FactService.SaveFactAsync(new FlashcardFactDraft(
            null, "deck-1", "type-terms",
            new Dictionary<string, string> { ["term"] = "Amiodarone", ["meaning"] = "Class III" },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(), ["drugs"]));
        await harness.FactService.SaveFactAsync(new FlashcardFactDraft(
            null, "deck-1", FlashcardCardType.ClozeId,
            new Dictionary<string, string> { ["text"] = "{{c1::Amiodarone}} is {{c2::class III}}.", ["extra"] = "Antiarrhythmic" },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(), []));

        // Use non-null scheduling fields so a dropped field cannot pass the round-trip comparison.
        var studied = terms.Cards[0];
        await harness.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await harness.Schedules.UpsertAsync(conn, tx, new FlashcardSchedule(
                studied.Id, Now.AddDays(9), 41.5, 5.25, 4, 1, FlashcardFsrsState.Review, 2, Now.AddDays(-1),
                Now.AddDays(-3)), ct);
            await harness.Reviews.AppendAsync(conn, tx, new FlashcardReviewLog(
                FlashcardReviewLog.Unassigned, studied.Id, "deck-1", "session-1", FlashcardReviewGrade.Good,
                Now.AddDays(-2), 3.0, 4.0, 30.1, 5.0, FlashcardFsrsState.Review, FlashcardFsrsState.Review), ct);
            await harness.Reviews.AppendAsync(conn, tx, new FlashcardReviewLog(
                FlashcardReviewLog.Unassigned, studied.Id, "deck-1", "session-2", FlashcardReviewGrade.Again,
                Now.AddDays(-1), 1.0, 4.0, 12.4, 6.1, FlashcardFsrsState.Review, FlashcardFsrsState.Relearning), ct);
            await harness.DailyStats.IncrementAsync(conn, tx, "deck-1", "2026-03-03", 3, 11, ct);
        });

        return harness;
    }

    // ---- Reading a collection back ------------------------------------------------------------

    private static FlashcardLibraryService LibraryOf(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    /// <summary>
    /// Everything a restore is supposed to bring back, as comparable text. Ids are in it on
    /// purpose: this is the assertion that a restore is a restore rather than a copy.
    /// </summary>
    private static Task<string> ReadCollectionAsync(FlashcardStoreHarness h) => ReadDeckAsync(h, "deck-1");

    private static async Task<string> ReadDeckAsync(FlashcardStoreHarness h, string deckId)
    {
        var lines = new List<string>();
        var deck = await h.Store.ReadAsync((conn, ct) => h.Decks.GetHeaderAsync(conn, deckId, ct));
        lines.Add($"deck {deck!.Id} {deck.Name} preset={deck.PresetId} tags={string.Join(",", deck.Tags)}");

        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var page = await cards.ListCardsAsync(new FlashcardCardQuery(deckId, Limit: 500));
        foreach (var view in page.Items.OrderBy(v => v.Card.Id, StringComparer.Ordinal))
        {
            lines.Add(
                $"card {view.Card.Id} fact={view.Card.FactId} layout={view.Card.LayoutKey} " +
                $"front={view.Card.Front} back={view.Card.Back} state={view.Card.State} " +
                $"due={view.Schedule.DueDate:O} stability={view.Schedule.Stability} difficulty={view.Schedule.Difficulty} " +
                $"reps={view.Schedule.Reps} lapses={view.Schedule.Lapses} fsrs={view.Schedule.FsrsState} " +
                $"step={view.Schedule.LearningStepIndex} lastReviewed={view.Schedule.LastReviewedAt?.ToString("O")} " +
                $"buried={view.Schedule.BuriedUntil?.ToString("O")}");
        }

        var facts = await h.Store.ReadAsync((conn, ct) => h.Facts.ListByDeckAsync(conn, deckId, ct));
        foreach (var fact in facts.OrderBy(f => f.Id, StringComparer.Ordinal))
        {
            var values = string.Join(";", fact.Values.OrderBy(v => v.Key, StringComparer.Ordinal).Select(v => $"{v.Key}={v.Value}"));
            lines.Add($"fact {fact.Id} type={fact.TypeId} tags={string.Join(",", fact.Tags)} {values}");
        }

        var reviews = await h.Store.ReadAsync((conn, ct) => h.Reviews.ListAllForDeckAsync(conn, deckId, ct));
        foreach (var review in reviews)
            lines.Add(
                $"review {review.Id} card={review.CardId} grade={review.Grade} before={review.StateBefore} " +
                $"at={review.ReviewedAt:O} after={review.StateAfter} elapsed={review.ElapsedDays} " +
                $"scheduled={review.ScheduledDays} stabilityAfter={review.StabilityAfter} difficultyAfter={review.DifficultyAfter}");

        var stats = await h.Store.ReadAsync((conn, ct) => h.DailyStats.ListAllForDeckAsync(conn, deckId, ct));
        foreach (var stat in stats)
            lines.Add($"day {stat.Date} new={stat.NewIntroduced} reviews={stat.ReviewsDone}");

        return string.Join("\n", lines);
    }

    private static async Task<IReadOnlyList<Flashcard>> ClozeCardsAsync(FlashcardStoreHarness h)
    {
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var page = await cards.ListCardsAsync(new FlashcardCardQuery("deck-1", Limit: 500));
        return page.Items
            .Select(v => v.Card)
            .Where(c => c.LayoutKey is not null && c.LayoutKey.StartsWith('c') && c.LayoutKey.Length == 2)
            .ToList();
    }

    /// <summary>
    /// A payload database holding one deck and one review whose JSON has every field a review
    /// carried before it recorded where the answer came from, and no origin field at all.
    /// </summary>
    private static byte[] PayloadWithoutReviewOriginBytes()
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-no-origin-{Guid.NewGuid():N}.db");
        try
        {
            using (var connection = new SqliteConnection($"Data Source={tempPath};Pooling=False"))
            {
                connection.Open();
                using (var create = connection.CreateCommand())
                {
                    create.CommandText = """
                        CREATE TABLE Decks (DeckId TEXT PRIMARY KEY, Json TEXT NOT NULL);
                        CREATE TABLE Reviews (ReviewId INTEGER PRIMARY KEY, Json TEXT NOT NULL);
                        """;
                    create.ExecuteNonQuery();
                }

                var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
                var deck = new
                {
                    id = "deck-before-origins",
                    name = "Before origins",
                    tags = Array.Empty<string>(),
                    cards = new[]
                    {
                        new
                        {
                            id = "card-before-origins",
                            deckId = "deck-before-origins",
                            front = "Q",
                            back = "A",
                            type = 0,
                            dueDate = Now.AddDays(2),
                            fsrsState = 2,
                        },
                    },
                };

                var review = new
                {
                    id = 7L,
                    cardId = "card-before-origins",
                    deckId = "deck-before-origins",
                    sessionId = "session-old",
                    grade = (int)FlashcardReviewGrade.Good,
                    reviewedAt = Now.AddDays(-6),
                    elapsedDays = 3.0,
                    scheduledDays = 4.0,
                    stabilityAfter = 22.5,
                    difficultyAfter = 5.1,
                    stateBefore = (int)FlashcardFsrsState.Review,
                    stateAfter = (int)FlashcardFsrsState.Review,
                };

                Insert(connection, "INSERT INTO Decks (DeckId, Json) VALUES ($id, $json)", "deck-before-origins", JsonSerializer.Serialize(deck, options));
                Insert(connection, "INSERT INTO Reviews (ReviewId, Json) VALUES ($id, $json)", 7L, JsonSerializer.Serialize(review, options));
            }

            return File.ReadAllBytes(tempPath);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }

    private static void Insert(SqliteConnection connection, string sql, object id, string json)
    {
        using var insert = connection.CreateCommand();
        insert.CommandText = sql;
        insert.Parameters.AddWithValue("$id", id);
        insert.Parameters.AddWithValue("$json", json);
        insert.ExecuteNonQuery();
    }

    /// <summary>
    /// A payload database in the format shipped before this one: two tables, and a card snapshot
    /// with no material, no profile and no timestamps.
    /// </summary>
    private static byte[] LegacyPayloadBytes()
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"mnemo-legacy-{Guid.NewGuid():N}.db");
        try
        {
            using (var connection = new SqliteConnection($"Data Source={tempPath};Pooling=False"))
            {
                connection.Open();
                using (var create = connection.CreateCommand())
                {
                    create.CommandText = """
                        CREATE TABLE Decks (DeckId TEXT PRIMARY KEY, Json TEXT NOT NULL);
                        CREATE TABLE Folders (FolderId TEXT PRIMARY KEY, Json TEXT NOT NULL);
                        """;
                    create.ExecuteNonQuery();
                }

                var deck = new
                {
                    id = "legacy-deck",
                    name = "Legacy",
                    tags = Array.Empty<string>(),
                    retentionScore = 80,
                    schedulingAlgorithm = 1,
                    cards = new[]
                    {
                        new
                        {
                            id = "legacy-card",
                            deckId = "legacy-deck",
                            front = "Old question",
                            back = "Old answer",
                            type = 0,
                            tags = Array.Empty<string>(),
                            dueDate = Now.AddDays(4),
                            stability = 9.5,
                            difficulty = 5.5,
                            reviewCount = 3,
                            lapseCount = 1,
                            fsrsState = 2,
                            state = 0,
                            isFlagged = false,
                        },
                    },
                };

                using var insert = connection.CreateCommand();
                insert.CommandText = "INSERT INTO Decks (DeckId, Json) VALUES ($id, $json)";
                insert.Parameters.AddWithValue("$id", "legacy-deck");
                insert.Parameters.AddWithValue("$json", JsonSerializer.Serialize(deck, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
                insert.ExecuteNonQuery();
            }

            return File.ReadAllBytes(tempPath);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }
}
