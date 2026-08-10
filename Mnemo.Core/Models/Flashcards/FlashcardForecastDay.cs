using System;

namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// One column of the review forecast: how much work a UTC calendar day is scheduled to hand back.
/// </summary>
/// <remarks>
/// UTC days, not local ones, so the forecast lines up with every other dated number on the
/// overview: the daily statistics records are keyed by UTC day and the widgets read them that way.
/// A forecast on local days would disagree with the activity heatmap beside it for part of every
/// day in most of the world.
/// </remarks>
/// <param name="Day">The UTC calendar day this column covers.</param>
/// <param name="Due">
/// Cards scheduled to come back. Today's column is the cap-aware queue (learning plus review, with
/// anything overdue folded in), which is the same number the due-today banner shows; later columns
/// are raw scheduled counts, because a cap depends on how much of the queue actually gets done.
/// </param>
/// <param name="New">
/// Unseen cards. Only today's column carries one: it is today's remaining new allowance. A future
/// day's new count would be a guess about how much studying happens between now and then, and a
/// chart is a bad place to put a guess.
/// </param>
public sealed record FlashcardForecastDay(DateOnly Day, int Due, int New)
{
    /// <summary>Everything scheduled for the day, both buckets together.</summary>
    public int Total => Due + New;
}
