using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Statistics;

namespace Mnemo.Infrastructure.Services.Statistics;

/// <summary>
/// Process-local statistics store used by tests and ephemeral scenarios. Behaviorally equivalent
/// to <see cref="SqliteStatisticsStore"/>, which has its own tests against a database on disk.
/// </summary>
internal sealed class InMemoryStatisticsStore : IStatisticsStore
{
    private readonly ConcurrentDictionary<string, StatisticsRecord> _records = new(StringComparer.Ordinal);
    private readonly object _writeLock = new();

    private static string MakeKey(string ns, string kind, string key) => ns + "\u001f" + kind + "\u001f" + key;

    public Task<StatisticsRecord?> GetAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
    {
        _records.TryGetValue(MakeKey(ns, kind, key), out var rec);
        return Task.FromResult<StatisticsRecord?>(rec);
    }

    public Task<bool> ExistsAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
        => Task.FromResult(_records.ContainsKey(MakeKey(ns, kind, key)));

    public Task<StatisticsRecord> InsertAsync(StatisticsRecord record, CancellationToken cancellationToken = default)
    {
        lock (_writeLock)
        {
            _records[MakeKey(record.Namespace, record.Kind, record.Key)] = record;
        }
        return Task.FromResult(record);
    }

    public Task<StatisticsRecord?> UpdateAsync(StatisticsRecord record, long? expectedVersion, CancellationToken cancellationToken = default)
    {
        lock (_writeLock)
        {
            var key = MakeKey(record.Namespace, record.Kind, record.Key);
            if (!_records.TryGetValue(key, out var existing))
                return Task.FromResult<StatisticsRecord?>(null);
            if (expectedVersion.HasValue && existing.Version != expectedVersion.Value)
                return Task.FromResult<StatisticsRecord?>(null);
            _records[key] = record;
            return Task.FromResult<StatisticsRecord?>(record);
        }
    }

    public Task DeleteAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
    {
        lock (_writeLock)
        {
            _records.TryRemove(MakeKey(ns, kind, key), out _);
        }
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<StatisticsRecord>> QueryAsync(StatisticsQuery query, CancellationToken cancellationToken = default)
    {
        if (query == null) throw new ArgumentNullException(nameof(query));
        IEnumerable<StatisticsRecord> q = _records.Values
            .Where(r => string.Equals(r.Namespace, query.Namespace, StringComparison.Ordinal));

        if (!string.IsNullOrEmpty(query.Kind))
            q = q.Where(r => string.Equals(r.Kind, query.Kind, StringComparison.Ordinal));

        if (!string.IsNullOrEmpty(query.KeyPrefix))
            q = q.Where(r => r.Key.StartsWith(query.KeyPrefix, StringComparison.Ordinal));

        if (query.UpdatedAfter.HasValue)
            q = q.Where(r => r.UpdatedAt >= query.UpdatedAfter.Value);

        if (query.UpdatedBefore.HasValue)
            q = q.Where(r => r.UpdatedAt <= query.UpdatedBefore.Value);

        q = query.OrderByUpdatedDescending
            ? q.OrderByDescending(r => r.UpdatedAt)
            : q.OrderBy(r => r.UpdatedAt);

        var limit = query.Limit > 0 ? Math.Min(query.Limit, 1000) : 100;
        return Task.FromResult<IReadOnlyList<StatisticsRecord>>(q.Take(limit).ToList());
    }
}
