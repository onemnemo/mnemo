using System;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// One row of the review log, read in bulk. Carries only the columns weight fitting reads, which
/// is why it is narrower than <see cref="FlashcardReviewLog"/>.
/// </summary>
/// <remarks>
/// <paramref name="Id"/> is the tie-breaker for two answers that share a timestamp: the column is
/// an autoincrement, so the lower id is the earlier answer.
/// </remarks>
public readonly record struct FlashcardReviewRow(
    long Id,
    string CardId,
    FlashcardReviewGrade Grade,
    DateTimeOffset ReviewedAt,
    double ElapsedDays,
    FlashcardFsrsState? StateBefore,
    FlashcardFsrsState StateAfter);
