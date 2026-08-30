using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Security.Cryptography;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// The destinations the user has actually agreed to, each behind a one-shot token.
/// </summary>
/// <remarks>
/// A save route would otherwise take a path from the page and write to it, which is a way to put a
/// file of chosen contents anywhere the process can reach: a startup folder, a shell profile, a
/// config the app itself reads back. The renderer is not a trusted author of one, since the content
/// it renders can come from a package a stranger made.
///
/// So a path is only ever writable because a native chooser returned it moments earlier. The token
/// is the proof, it is spent on use, and it expires on its own so an export the user abandoned does
/// not leave a writable destination lying around.
/// </remarks>
public sealed class ExportGrants
{
    /// <summary>
    /// How long a chosen destination stays writable by default. Long enough to upload a large
    /// package over loopback, short enough that an abandoned dialog stops mattering quickly.
    /// </summary>
    public static readonly TimeSpan DefaultLifetime = TimeSpan.FromMinutes(5);

    private readonly ConcurrentDictionary<string, Grant> _grants = new(StringComparer.Ordinal);
    private readonly TimeSpan _lifetime;

    /// <param name="lifetime">Overridable so the lapse can be tested without waiting for it.</param>
    public ExportGrants(TimeSpan? lifetime = null) => _lifetime = lifetime ?? DefaultLifetime;

    private sealed record Grant(ExportTarget Target, DateTimeOffset Expires);

    /// <summary>Mints a token for a destination the user just chose.</summary>
    /// <returns>The token the write route will require. Never null or empty.</returns>
    public string Issue(ExportTarget target)
    {
        // Swept on the way in rather than on a timer: grants are only created here, so this is the
        // one moment the collection can grow, and an export nobody completed cannot accumulate.
        Sweep();

        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        _grants[token] = new Grant(target, DateTimeOffset.UtcNow + _lifetime);
        return token;
    }

    /// <summary>
    /// Spends a token and hands back the destination it stands for.
    /// </summary>
    /// <remarks>
    /// The destination comes from the grant, never from the request. A token that authorized one
    /// path while the bytes went to another would be worse than no token at all.
    /// </remarks>
    /// <param name="token">The token from <see cref="Issue"/>. Null, unknown, spent or expired all
    /// return false.</param>
    /// <param name="target">The destination, or null when this returns false.</param>
    public bool TryConsume(string? token, out ExportTarget? target)
    {
        target = null;
        if (string.IsNullOrWhiteSpace(token) || !_grants.TryRemove(token, out var grant))
            return false;

        // Removed either way: a token presented after it lapsed is spent, not retryable.
        if (grant.Expires <= DateTimeOffset.UtcNow)
            return false;

        target = grant.Target;
        return true;
    }

    private void Sweep()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var stale in _grants.Where(entry => entry.Value.Expires <= now).Select(entry => entry.Key).ToArray())
            _grants.TryRemove(stale, out _);
    }
}
