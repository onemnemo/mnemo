using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Mnemo.Host.Backup;

public sealed class ProfileRestoreGrants
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
    private readonly ConcurrentDictionary<string, Grant> _grants = new(StringComparer.Ordinal);
    private readonly TimeProvider _timeProvider;

    private sealed record Grant(string Path, DateTimeOffset ExpiresAt);

    public ProfileRestoreGrants(TimeProvider timeProvider)
    {
        _timeProvider = timeProvider;
    }

    public string Issue(string path)
    {
        Sweep();
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        _grants[token] = new Grant(Path.GetFullPath(path), _timeProvider.GetUtcNow() + Lifetime);
        return token;
    }

    public bool TryConsume(string? token, out string? path)
    {
        path = null;
        if (string.IsNullOrWhiteSpace(token) || !_grants.TryRemove(token, out var grant))
            return false;
        if (grant.ExpiresAt <= _timeProvider.GetUtcNow())
            return false;
        path = grant.Path;
        return true;
    }

    private void Sweep()
    {
        var now = _timeProvider.GetUtcNow();
        foreach (var key in _grants.Where(pair => pair.Value.ExpiresAt <= now).Select(pair => pair.Key).ToArray())
            _grants.TryRemove(key, out _);
    }
}
