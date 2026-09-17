namespace Mnemo.Host.Contracts;

/// <summary>
/// Batch body for giving cards a due date. <c>Days</c> counts study days from today, zero being
/// today; <c>MatchInterval</c> also rewrites each card's stability so the new spacing is the one
/// the scheduler believes in. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side is
/// authoritative.
/// </summary>
public sealed record SetCardsDueDto(IReadOnlyList<string>? CardIds, int Days, bool MatchInterval);

/// <summary>
/// Batch body for sending cards back to the new queue. With <c>KeepCounts</c> off the reps and
/// lapses on the card are zeroed as well; the review log is kept either way.
/// </summary>
public sealed record ResetCardsDto(IReadOnlyList<string>? CardIds, bool KeepCounts);

/// <summary>
/// Batch body for placing new cards in their deck's queue. <c>Place</c> is <c>start</c>, <c>end</c>
/// or <c>at</c>; <c>Position</c> is one-based and read only for <c>at</c>.
/// </summary>
public sealed record RepositionCardsDto(IReadOnlyList<string>? CardIds, string Place, int? Position);

/// <summary>How many active new cards a deck's queue holds.</summary>
public sealed record NewQueueDto(int Count);
