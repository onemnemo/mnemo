using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;

namespace Mnemo.Infrastructure.Tests.Proofing;

internal sealed class SilentLogger : ILoggerService
{
    public void Log(LogLevel level, string category, string message, Exception? exception = null)
    {
    }
}

/// <summary>In-memory settings, so a store's read-modify-write cycle can be exercised without a database.</summary>
internal sealed class MemorySettings : ISettingsService
{
    private readonly Dictionary<string, object?> _values = new(StringComparer.Ordinal);

    public event EventHandler<string>? SettingChanged;

    /// <summary>Delay applied inside every write, to widen the window a missing lock would lose a word in.</summary>
    public TimeSpan WriteDelay { get; set; }

    public MemorySettings Seed<T>(string key, T value)
    {
        _values[key] = value;
        return this;
    }

    /// <summary>
    /// Yields before answering, the way a read from storage does. A synchronous answer here lets every
    /// caller finish its read before any of them reaches an await, so a read-modify-write race cannot
    /// interleave and a test written to catch one passes with the lock removed.
    /// </summary>
    public async Task<T> GetAsync<T>(string key, T defaultValue = default!)
    {
        await Task.Yield();
        return _values.TryGetValue(key, out var value) && value is T typed ? typed : defaultValue;
    }

    public async Task SetAsync<T>(string key, T value)
    {
        if (WriteDelay > TimeSpan.Zero)
            await Task.Delay(WriteDelay).ConfigureAwait(false);

        _values[key] = value;
        SettingChanged?.Invoke(this, key);
    }

    public Task<bool> ExistsAsync(string key)
        => Task.FromResult(_values.TryGetValue(key, out var value) && value is not null);
}

/// <summary>
/// An engine that reports whatever it was told to, so the filtering and language rules above it can be
/// tested without loading a dictionary.
/// </summary>
internal sealed class StubProofingEngine : IProofingEngine
{
    private readonly string[] _flagged;

    public StubProofingEngine(IReadOnlyList<string> languages, params string[] flagged)
    {
        Languages = [.. languages];
        _flagged = flagged;
    }

    public string Id => "stub";

    public IReadOnlyList<string> Languages { get; }

    public bool Ready { get; set; } = true;

    /// <summary>What this engine reports its issues as, for the merge rules that turn on the kind.</summary>
    public string Kind { get; set; } = "spelling";

    /// <summary>Words flagged for one language only, instead of the ones flagged for all of them.</summary>
    public Dictionary<string, string[]> FlaggedFor { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Languages whose word list could not be read: they answer with nothing and never turn ready,
    /// which is what a failed read leaves behind in the real engine.
    /// </summary>
    public HashSet<string> Unreadable { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>False for an engine with nothing to offer, so the caller moves on to the next one.</summary>
    public bool Suggests { get; set; } = true;

    /// <summary>What this engine's suggestion says, so a test can tell which of two answered.</summary>
    public string? SuggestionLabel { get; set; }

    /// <summary>Blocks every check until set, standing in for a word list that is still being read.</summary>
    public TaskCompletionSource? Gate { get; set; }

    public bool IsReady(string language) => Ready && !Unreadable.Contains(language);

    public async ValueTask<IReadOnlyList<ProofingIssue>> CheckAsync(string language, string text, CancellationToken ct)
    {
        if (Gate is not null)
            await Gate.Task.WaitAsync(ct).ConfigureAwait(false);

        if (Unreadable.Contains(language))
            return [];

        var issues = new List<ProofingIssue>();
        foreach (var word in FlaggedFor.TryGetValue(language, out var only) ? only : _flagged)
        {
            var at = text.IndexOf(word, StringComparison.Ordinal);
            if (at < 0)
                continue;

            issues.Add(new ProofingIssue(at, at + word.Length, word, Kind, "error", null, null, null, []));
        }

        return issues;
    }

    public ValueTask<IReadOnlyList<ProofingFix>> SuggestAsync(
        string language,
        ProofingIssue issue,
        string text,
        CancellationToken ct)
        => ValueTask.FromResult<IReadOnlyList<ProofingFix>>(
            Suggests ? [new ProofingFix(SuggestionLabel ?? issue.Text.ToUpperInvariant(), null)] : []);
}
