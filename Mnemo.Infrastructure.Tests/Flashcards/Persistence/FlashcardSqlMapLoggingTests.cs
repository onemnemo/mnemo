using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// A stored JSON column that cannot be parsed falls back to an empty value rather than throwing, but
/// that fallback is exactly the moment a caller most needs to know something is wrong: saving the row
/// again writes the empty value back and the original content is gone for good. These tests prove the
/// fallback is reported through <see cref="ILoggerService"/> when a repository is given one.
/// </summary>
public sealed class FlashcardSqlMapLoggingTests
{
    [Fact]
    public async Task ReadingADeckWithCorruptTagsJson_LogsAWarning_AndFallsBackToEmptyTags()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        await CorruptColumnAsync(h, "FlashcardDecks", "TagsJson", deckId);

        var logger = new RecordingLogger();
        var deckRepo = new DeckRepository(logger);
        var header = await h.Store.ReadAsync((conn, ct) => deckRepo.GetHeaderAsync(conn, deckId, ct));

        Assert.NotNull(header);
        Assert.Empty(header!.Tags);
        var warning = Assert.Single(logger.Warnings);
        Assert.Equal("Flashcards", warning.Category);
        Assert.Contains(deckId, warning.Message);
        Assert.Contains("TagsJson", warning.Message);
    }

    [Fact]
    public async Task ReadingACardWithCorruptAttachmentsJson_LogsAWarning_AndFallsBackToNoAttachments()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();
        await h.AddCardAsync(FlashcardStoreHarness.Card("c1", deckId, "front", "back"),
            Core.Models.Flashcards.FlashcardSchedule.NewFor("c1", DateTimeOffset.UtcNow));
        await CorruptColumnAsync(h, "FlashcardCards", "AttachmentsJson", "c1");

        var logger = new RecordingLogger();
        var cardRepo = new CardRepository(logger);
        var card = await h.Store.ReadAsync((conn, ct) => cardRepo.GetAsync(conn, "c1", ct));

        Assert.NotNull(card);
        Assert.Empty(card!.Attachments);
        var warning = Assert.Single(logger.Warnings);
        Assert.Contains("c1", warning.Message);
        Assert.Contains("AttachmentsJson", warning.Message);
    }

    [Fact]
    public async Task ReadingADeckWithValidJson_NeverLogs()
    {
        await using var h = new FlashcardStoreHarness();
        var deckId = await h.SeedDeckAsync();

        var logger = new RecordingLogger();
        var deckRepo = new DeckRepository(logger);
        await h.Store.ReadAsync((conn, ct) => deckRepo.GetHeaderAsync(conn, deckId, ct));

        Assert.Empty(logger.Warnings);
    }

    private static async Task CorruptColumnAsync(FlashcardStoreHarness h, string table, string column, string id)
    {
        await h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = $"UPDATE {table} SET {column} = 'not json' WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", id);
            await cmd.ExecuteNonQueryAsync(ct);
        });
    }

    private sealed class RecordingLogger : ILoggerService
    {
        public List<(string Category, string Message)> Warnings { get; } = new();

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
            if (level == LogLevel.Warning)
                Warnings.Add((category, message));
        }
    }
}
