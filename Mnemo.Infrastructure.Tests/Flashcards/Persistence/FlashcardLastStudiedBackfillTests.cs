using System;
using System.IO;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Opening a collection whose decks were imported with review history before imports set the last
/// studied time.
/// </summary>
public sealed class FlashcardLastStudiedBackfillTests
{
    private static readonly DateTimeOffset Seeded = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Earlier = new(2025, 11, 2, 8, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Later = new(2026, 1, 15, 19, 45, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Studied = new(2026, 2, 1, 7, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task A_deck_with_history_but_no_time_gets_its_newest_review_and_others_are_left_alone()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_laststudied_{Guid.NewGuid():N}.db");
        try
        {
            await using (var store = new FlashcardStore(new TestLogger(), path, new TestTimeProvider(Seeded)))
            {
                await store.InitializeAsync();
                await store.WriteAsync(async (conn, tx, ct) =>
                {
                    await new PresetRepository().UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(Seeded), ct);
                    var decks = new DeckRepository();
                    await decks.UpsertAsync(conn, tx, Deck("imported", lastStudied: null), ct);
                    await decks.UpsertAsync(conn, tx, Deck("studied", lastStudied: Studied), ct);
                    await decks.UpsertAsync(conn, tx, Deck("fresh", lastStudied: null), ct);

                    var reviews = new ReviewRepository();
                    foreach (var (deckId, at) in new[] { ("imported", Later), ("imported", Earlier), ("studied", Later) })
                    {
                        await reviews.AppendAsync(conn, tx, new FlashcardReviewLog(
                            FlashcardReviewLog.Unassigned, "c", deckId, "s", FlashcardReviewGrade.Good, at, 0, 1, null, null,
                            FlashcardFsrsState.Review, FlashcardFsrsState.Review), ct);
                    }
                });
            }

            await StampVersionAsync(path, FlashcardStoreSchema.TargetVersion - 1);

            await using (var store = new FlashcardStore(new TestLogger(), path, new TestTimeProvider(Seeded)))
            {
                await store.InitializeAsync();
                var decks = new DeckRepository();
                var imported = await store.ReadAsync((conn, ct) => decks.GetHeaderAsync(conn, "imported", ct));
                var studied = await store.ReadAsync((conn, ct) => decks.GetHeaderAsync(conn, "studied", ct));
                var fresh = await store.ReadAsync((conn, ct) => decks.GetHeaderAsync(conn, "fresh", ct));

                Assert.Equal(Later, imported!.LastStudied);
                Assert.Equal(Studied, studied!.LastStudied);
                Assert.Null(fresh!.LastStudied);
            }
        }
        finally
        {
            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                try { File.Delete(path + suffix); }
                catch (IOException) { /* best effort, as the store harness does */ }
            }
        }
    }

    private static FlashcardDeckHeader Deck(string id, DateTimeOffset? lastStudied) =>
        new(id, null, FlashcardPreset.StandardPresetId, id, null, [], 0, lastStudied, null, Seeded, Seeded);

    private static async Task StampVersionAsync(string path, int version)
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={path};Pooling=False");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM FlashcardSchemaVersion; INSERT INTO FlashcardSchemaVersion (Version, AppliedAt) VALUES ($v, '2026-03-04T09:00:00.0000000+00:00');";
        command.Parameters.AddWithValue("$v", version);
        await command.ExecuteNonQueryAsync();
    }
}
