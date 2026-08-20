using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <inheritdoc />
public sealed class FlashcardReviewHistoryService : IFlashcardReviewHistoryService
{
    private readonly IFlashcardStore _store;
    private readonly IReviewRepository _reviews;

    public FlashcardReviewHistoryService(IFlashcardStore store, IReviewRepository reviews)
    {
        _store = store;
        _reviews = reviews;
    }

    public Task<IReadOnlyList<FlashcardReviewLog>> ListForCardsAsync(
        IReadOnlyList<string> cardIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(cardIds);
        return _store.ReadAsync((conn, ct) => _reviews.ListForCardsAsync(conn, cardIds, ct), cancellationToken);
    }

    /// <summary>
    /// Writes the rows and nothing else. No schedule is moved, no daily counter is charged and no
    /// deck is marked as studied: a package arriving is not a study session, and treating it as one
    /// would spend today's review cap on answers given months ago in another app.
    /// </summary>
    public Task<int> AddImportedAsync(
        IReadOnlyList<FlashcardReviewLog> reviews, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(reviews);
        if (reviews.Count == 0)
            return Task.FromResult(0);

        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            var written = 0;
            foreach (var review in reviews)
            {
                await _reviews.AppendAsync(conn, tx, review with { Origin = FlashcardReviewOrigin.Imported }, ct)
                    .ConfigureAwait(false);
                written++;
            }

            return written;
        }, cancellationToken);
    }
}
