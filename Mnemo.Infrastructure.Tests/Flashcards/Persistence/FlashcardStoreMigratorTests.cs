using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

public sealed class FlashcardStoreMigratorTests
{
    private const string LegacyKey = "flashcards.state.v2";
    private const string BackupKey = "flashcards.state.v2.migrated-backup";

    [Fact]
    public async Task Migrate_MovesFoldersDecksCards_AndPreservesFsrsState()
    {
        await using var h = new FlashcardStoreHarness();
        var storage = new InMemoryStorageProvider();
        var now = DateTimeOffset.UtcNow;
        await storage.SaveAsync(LegacyKey, BuildLegacyBlob(now));

        var migrator = CreateMigrator(h, storage);
        await migrator.MigrateAsync();

        // Standard preset seeded and decks attached to it.
        var preset = await h.Store.ReadAsync((c, ct) => h.Presets.GetAsync(c, FlashcardPreset.StandardPresetId, ct));
        Assert.NotNull(preset);

        var folders = await h.Store.ReadAsync((c, ct) => h.Folders.ListAsync(c, ct));
        var decks = await h.Store.ReadAsync((c, ct) => h.Decks.ListHeadersAsync(c, ct));
        Assert.Single(folders);
        Assert.Equal(2, decks.Count);

        var fsrsCard = await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, "c1", ct));
        Assert.NotNull(fsrsCard);
        Assert.Equal(FlashcardFsrsState.Review, fsrsCard!.FsrsState);
        Assert.Equal(3, fsrsCard.Reps);
        Assert.Equal(5, fsrsCard.Stability);

        // SM2-origin card reset to New, due now.
        var sm2Card = await h.Store.ReadAsync((c, ct) => h.Schedules.GetAsync(c, "c3", ct));
        Assert.NotNull(sm2Card);
        Assert.Equal(FlashcardFsrsState.New, sm2Card!.FsrsState);
    }

    [Fact]
    public async Task Migrate_ReplaysOnlyReviewSessions_IntoReviewLog()
    {
        await using var h = new FlashcardStoreHarness();
        var storage = new InMemoryStorageProvider();
        await storage.SaveAsync(LegacyKey, BuildLegacyBlob(DateTimeOffset.UtcNow));

        await CreateMigrator(h, storage).MigrateAsync();

        var reviewCount = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, "d1", ct));
        Assert.Equal(1, reviewCount); // the Cram session is ignored, only the single Review card result lands
    }

    [Fact]
    public async Task Migrate_LeavesBackup_AndRetiresOriginalKey()
    {
        await using var h = new FlashcardStoreHarness();
        var storage = new InMemoryStorageProvider();
        await storage.SaveAsync(LegacyKey, BuildLegacyBlob(DateTimeOffset.UtcNow));

        await CreateMigrator(h, storage).MigrateAsync();

        Assert.False(storage.Raw.ContainsKey(LegacyKey));
        Assert.True(storage.Raw.ContainsKey(BackupKey));
    }

    [Fact]
    public async Task Migrate_IsIdempotent_WhenRunTwice()
    {
        await using var h = new FlashcardStoreHarness();
        var storage = new InMemoryStorageProvider();
        await storage.SaveAsync(LegacyKey, BuildLegacyBlob(DateTimeOffset.UtcNow));

        var migrator = CreateMigrator(h, storage);
        await migrator.MigrateAsync();
        await migrator.MigrateAsync(); // second run must be a no-op

        var decks = await h.Store.ReadAsync((c, ct) => h.Decks.ListHeadersAsync(c, ct));
        var reviewCount = await h.Store.ReadAsync((c, ct) => h.Reviews.CountForDeckAsync(c, "d1", ct));
        Assert.Equal(2, decks.Count);
        Assert.Equal(1, reviewCount); // not doubled
    }

    [Fact]
    public async Task Migrate_NoOp_WhenNoLegacyBlob()
    {
        await using var h = new FlashcardStoreHarness();
        var storage = new InMemoryStorageProvider();

        await CreateMigrator(h, storage).MigrateAsync();

        var decks = await h.Store.ReadAsync((c, ct) => h.Decks.ListHeadersAsync(c, ct));
        Assert.Empty(decks);
    }

    private static FlashcardStoreMigrator CreateMigrator(FlashcardStoreHarness h, InMemoryStorageProvider storage) =>
        new(h.Store, storage, h.Presets, h.Folders, h.Decks, h.Cards, h.Schedules, h.Reviews, new TestLogger());

    // Builds the legacy blob as anonymous objects matching the old JSON shape (PascalCase names,
    // enums as ints), so this test carries no dependency on the retired model records.
    private static object BuildLegacyBlob(DateTimeOffset now)
    {
        var c1 = new
        {
            Id = "c1", DeckId = "d1", Front = "F1", Back = "B1", Type = 0, Tags = Array.Empty<string>(),
            DueDate = now, Stability = (double?)5, Difficulty = (double?)5,
            ReviewCount = (int?)3, LapseCount = (int?)1, LastReviewedAt = (DateTimeOffset?)now.AddDays(-2),
            FsrsState = (int?)2 // Review
        };
        var c2 = new
        {
            Id = "c2", DeckId = "d1", Front = "F2", Back = "B2", Type = 1, Tags = Array.Empty<string>(),
            DueDate = now, Stability = (double?)null, Difficulty = (double?)null,
            ReviewCount = (int?)null, LapseCount = (int?)null, LastReviewedAt = (DateTimeOffset?)null,
            FsrsState = (int?)null
        };
        var c3 = new
        {
            Id = "c3", DeckId = "d2", Front = "F3", Back = "B3", Type = 0, Tags = Array.Empty<string>(),
            DueDate = now.AddDays(30), Stability = (double?)null, Difficulty = (double?)null,
            ReviewCount = (int?)null, LapseCount = (int?)null, LastReviewedAt = (DateTimeOffset?)null,
            FsrsState = (int?)null
        };

        var d1 = new { Id = "d1", Name = "Plate Tectonics", FolderId = "f1", Description = (string?)null, Tags = new[] { "geo" }, LastStudied = (DateTimeOffset?)null, Cards = new[] { c1, c2 }, SchedulingAlgorithm = 1 };
        var d2 = new { Id = "d2", Name = "Legacy SM2", FolderId = (string?)null, Description = (string?)null, Tags = Array.Empty<string>(), LastStudied = (DateTimeOffset?)null, Cards = new[] { c3 }, SchedulingAlgorithm = 2 };

        var reviewSession = new
        {
            DeckId = "d1",
            SessionConfig = new { SessionType = 0 }, // Review
            CardResults = new[] { new { CardId = "c1", Grade = 3, ReviewedAt = now.AddMinutes(-6) } }
        };
        var cramSession = new
        {
            DeckId = "d1",
            SessionConfig = new { SessionType = 3 }, // Cram
            CardResults = new[] { new { CardId = "c2", Grade = 1, ReviewedAt = now.AddMinutes(-16) } }
        };

        return new
        {
            Folders = new[] { new { Id = "f1", Name = "Geology", ParentId = (string?)null, Order = 0 } },
            Decks = new object[] { d1, d2 },
            SessionHistory = new[] { reviewSession, cramSession }
        };
    }
}
