using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// In-memory stateful study queue shared by Review and Cram. Cards graded into a learning/relearning
/// step are re-inserted a few positions ahead so they reappear within the session; graduated cards
/// leave. Review persists each grade through the study service; Cram persists nothing.
/// </summary>
internal sealed class FlashcardStudySession : IFlashcardSession
{
    private const int RequeueGap = 3;

    private readonly IFlashcardStudyService _service;
    private readonly IFsrsScheduler _scheduler;
    private readonly FlashcardClock _clock;
    private readonly FlashcardPreset _preset;
    private readonly string _sessionId = Guid.NewGuid().ToString("N");
    private readonly List<FlashcardView> _queue;
    private readonly Stack<UndoRecord> _undo = new();
    private readonly int _total;
    private int _completed;

    public FlashcardStudySession(
        IFlashcardStudyService service,
        IFsrsScheduler scheduler,
        FlashcardClock clock,
        FlashcardPreset preset,
        FlashcardSessionMode mode,
        string deckId,
        IReadOnlyList<FlashcardView> initialQueue)
    {
        _service = service;
        _scheduler = scheduler;
        _clock = clock;
        _preset = preset;
        Mode = mode;
        DeckId = deckId;
        _queue = new List<FlashcardView>(initialQueue);
        _total = _queue.Count;
    }

    public FlashcardSessionMode Mode { get; }
    public string DeckId { get; }
    public bool WritesSchedule => Mode == FlashcardSessionMode.Review;
    public bool IsFinished => _queue.Count == 0;
    public FlashcardView? Current => _queue.Count > 0 ? _queue[0] : null;

    public FlashcardSessionProgress Progress => new(
        New: _queue.Count(v => v.Schedule.FsrsState == FlashcardFsrsState.New),
        Learning: _queue.Count(v => v.Schedule.FsrsState is FlashcardFsrsState.Learning or FlashcardFsrsState.Relearning),
        Due: _queue.Count(v => v.Schedule.FsrsState == FlashcardFsrsState.Review),
        Completed: _completed,
        Total: _total);

    public string DescribeInterval(FlashcardReviewGrade grade)
    {
        var current = Current;
        return current is null ? string.Empty : _scheduler.DescribeInterval(current.Schedule, grade, _clock.Now, _preset);
    }

    public async Task GradeAsync(FlashcardReviewGrade grade, CancellationToken cancellationToken = default)
    {
        var current = Current;
        if (current is null)
            return;

        var now = _clock.Now;
        var updatedSchedule = _scheduler.ApplyGrade(current.Schedule, grade, now, _preset);
        var wasNew = current.Schedule.FsrsState == FlashcardFsrsState.New;

        long reviewId = 0;
        var localDay = _clock.KeyFor(now);
        if (WritesSchedule)
        {
            // A card with no prior review has no elapsed interval to log, so this is 0 rather than
            // the scheduler's formula, which falls back to the card's due date (its creation time
            // for a New card) and would otherwise log the card's age as if it were a review gap.
            var elapsedDays = current.Schedule.LastReviewedAt is null ? 0d : _scheduler.ElapsedDays(current.Schedule, now);
            var scheduledDays = Math.Max(0d, (current.Schedule.DueDate - (current.Schedule.LastReviewedAt ?? current.Schedule.DueDate)).TotalDays);
            var log = new FlashcardReviewLog(FlashcardReviewLog.Unassigned, current.Card.Id, DeckId, _sessionId,
                grade, now, elapsedDays, scheduledDays, updatedSchedule.Stability, updatedSchedule.Difficulty,
                current.Schedule.FsrsState, updatedSchedule.FsrsState);
            reviewId = await _service.RecordReviewAsync(new FlashcardReviewEntry(updatedSchedule, log, wasNew, localDay), cancellationToken).ConfigureAwait(false);
        }

        _queue.RemoveAt(0);
        var requeued = updatedSchedule.FsrsState is FlashcardFsrsState.Learning or FlashcardFsrsState.Relearning;
        var updatedView = current with { Schedule = updatedSchedule };
        if (requeued)
            _queue.Insert(Math.Min(_queue.Count, RequeueGap), updatedView);
        else
            _completed++;

        _undo.Push(new UndoRecord(current, reviewId, wasNew, localDay, requeued));
    }

    public async Task<bool> UndoAsync(CancellationToken cancellationToken = default)
    {
        if (_undo.Count == 0)
            return false;

        var record = _undo.Pop();
        if (WritesSchedule && record.ReviewId > 0)
            await _service.UndoReviewAsync(DeckId, record.Before.Schedule, record.ReviewId, record.LocalDay, record.WasNew, cancellationToken).ConfigureAwait(false);

        // Remove the post-grade copy of the card (if it was requeued) and restore the pre-grade card to the front.
        var idx = _queue.FindIndex(v => string.Equals(v.Card.Id, record.Before.Card.Id, StringComparison.Ordinal));
        if (idx >= 0)
            _queue.RemoveAt(idx);
        else if (!record.Requeued)
            _completed = Math.Max(0, _completed - 1);

        _queue.Insert(0, record.Before);
        return true;
    }

    private sealed record UndoRecord(FlashcardView Before, long ReviewId, bool WasNew, string LocalDay, bool Requeued);
}
