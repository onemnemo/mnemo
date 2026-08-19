using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;

namespace Mnemo.Host.Tests.Trash;

/// <summary>
/// A module the endpoint tests can put content into and make fail. The protocol itself is covered
/// against the coordinator; what matters here is only which shape each outcome reaches the client in.
/// </summary>
internal sealed class FakeHostTrashSource : ITrashSource
{
    private readonly Dictionary<string, FakeItem> _live = new(StringComparer.Ordinal);
    private readonly Dictionary<string, FakeItem> _held = new(StringComparer.Ordinal);

    public FakeHostTrashSource(string kind) => Kind = kind;

    /// <inheritdoc />
    public string Kind { get; }

    /// <summary>What a successful restore reports.</summary>
    public TrashRestoreOutcome RestoreOutcome { get; set; } = TrashRestoreOutcome.Restored;

    /// <summary>Entries a purge reports as owning rows in the same cascade.</summary>
    public IReadOnlyList<string>? PurgeBlockers { get; set; }

    /// <summary>Thrown by restore, which is how a test reaches an uncertain outcome.</summary>
    public Exception? RestoreFailure { get; set; }

    /// <summary>Thrown by the ownership probe, which is what makes an outcome uncertain.</summary>
    public Exception? HoldsFailure { get; set; }

    /// <summary>Adds a live item.</summary>
    public FakeHostTrashSource AddLive(string itemId, string title, string? origin = null, int containedCount = 0)
    {
        _live[itemId] = new FakeItem(itemId, title, origin, containedCount);
        return this;
    }

    /// <summary>Whether the item is visible to ordinary reads.</summary>
    public bool IsLive(string itemId) => _live.ContainsKey(itemId);

    /// <inheritdoc />
    public Task<TrashSnapshot?> PrepareAsync(string itemId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_live.TryGetValue(itemId, out var item) ? item.ToSnapshot() : null);

    /// <inheritdoc />
    public Task<TrashSnapshot?> CaptureAsync(string itemId, string entryId, CancellationToken cancellationToken = default)
    {
        if (_held.TryGetValue(entryId, out var already))
            return Task.FromResult<TrashSnapshot?>(already.ToSnapshot());

        if (!_live.Remove(itemId, out var item))
            return Task.FromResult<TrashSnapshot?>(null);

        _held[entryId] = item;
        return Task.FromResult<TrashSnapshot?>(item.ToSnapshot());
    }

    /// <inheritdoc />
    public Task<TrashRestore> RestoreAsync(
        string entryId,
        TrashRestoreTarget? target = null,
        CancellationToken cancellationToken = default)
    {
        if (!_held.TryGetValue(entryId, out var item))
            return Task.FromResult(new TrashRestore(TrashRestoreOutcome.Missing));

        var outcome = target is not null ? TrashRestoreOutcome.Restored : RestoreOutcome;
        if (outcome is TrashRestoreOutcome.DestinationRequired or TrashRestoreOutcome.BlockedByContainer)
            return Task.FromResult(new TrashRestore(outcome));

        if (RestoreFailure is not null)
            throw RestoreFailure;

        _held.Remove(entryId);
        _live[item.Id] = item;
        return Task.FromResult(new TrashRestore(outcome, target?.ContainerId));
    }

    /// <inheritdoc />
    public Task<TrashPurge> PurgeAsync(string entryId, CancellationToken cancellationToken = default)
    {
        if (!_held.TryGetValue(entryId, out _))
            return Task.FromResult(TrashPurge.Done());

        if (PurgeBlockers is { Count: > 0 } blockers)
            return Task.FromResult(TrashPurge.Blocked(blockers));

        _held.Remove(entryId);
        return Task.FromResult(TrashPurge.Done());
    }

    /// <inheritdoc />
    public Task<bool> HoldsAsync(string entryId, CancellationToken cancellationToken = default)
    {
        if (HoldsFailure is not null)
            throw HoldsFailure;
        return Task.FromResult(_held.ContainsKey(entryId));
    }

    /// <inheritdoc />
    public Task<IReadOnlyCollection<string>> HeldEntryIdsAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyCollection<string>>(_held.Keys.ToList());

    /// <inheritdoc />
    public Task ReleaseAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default)
    {
        foreach (var entryId in entryIds)
        {
            if (_held.Remove(entryId, out var item))
                _live[item.Id] = item;
        }

        return Task.CompletedTask;
    }

    private sealed record FakeItem(string Id, string Title, string? Origin, int ContainedCount)
    {
        public TrashSnapshot ToSnapshot() => new(Title, Origin, ContainedCount);
    }
}
