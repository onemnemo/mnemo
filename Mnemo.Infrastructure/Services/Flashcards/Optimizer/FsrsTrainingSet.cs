using System.Collections.Generic;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Optimizer;

/// <summary>
/// One answer as the trainer sees it: how long the card had been left, what the answer was, and
/// whether the fit is allowed to score the model's prediction against it.
/// </summary>
/// <remarks>
/// A same-day answer is replayed but not scored. Retrievability at a gap of zero is one by
/// definition, so an answer of Again inside a learning step would contribute an arbitrarily large
/// loss that no parameter can reduce, and would drown out every real interval in the collection.
/// </remarks>
public readonly record struct FsrsTrainingReview(double ElapsedDays, FlashcardReviewGrade Grade, bool Scored);

/// <summary>
/// One unbroken memory chain, oldest answer first, starting from the answer that created it.
/// </summary>
/// <remarks>
/// A card contributes more than one chain if its schedule was ever reset back to New, because the
/// memory state the model tracks starts over at that point.
/// </remarks>
public sealed record FsrsTrainingChain(string CardId, FsrsTrainingReview[] Reviews);

/// <summary>
/// Everything a fit runs on, plus the counts that explain how much of the review log survived.
/// </summary>
/// <param name="Chains">The memory chains to replay, in a fixed order so a fit is reproducible.</param>
/// <param name="ReviewsAvailable">Review rows read for the preset, before any rule was applied.</param>
/// <param name="ReviewsUsed">Rows kept, counting the unscored answers that still move memory state.</param>
/// <param name="ReviewsScored">Rows the loss is measured on.</param>
public sealed record FsrsTrainingSet(
    IReadOnlyList<FsrsTrainingChain> Chains,
    int ReviewsAvailable,
    int ReviewsUsed,
    int ReviewsScored);
