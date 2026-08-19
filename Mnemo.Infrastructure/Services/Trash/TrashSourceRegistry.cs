using System;
using System.Collections.Generic;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// The sources this build ships, indexed by kind.
/// </summary>
/// <remarks>
/// Two sources claiming one kind would each believe they own the same ledger rows, so that is a
/// wiring mistake and fails at construction rather than at the first delete.
/// </remarks>
public sealed class TrashSourceRegistry
{
    private readonly Dictionary<string, ITrashSource> _sources = new(StringComparer.Ordinal);

    /// <param name="sources">Every registered source.</param>
    /// <exception cref="InvalidOperationException">A source has a blank kind, or two claim one kind.</exception>
    public TrashSourceRegistry(IEnumerable<ITrashSource> sources)
    {
        ArgumentNullException.ThrowIfNull(sources);

        foreach (var source in sources)
        {
            if (string.IsNullOrWhiteSpace(source.Kind))
                throw new InvalidOperationException($"Trash source {source.GetType().Name} has no kind.");

            if (!_sources.TryAdd(source.Kind, source))
            {
                throw new InvalidOperationException(
                    $"Trash kind '{source.Kind}' is claimed by both {_sources[source.Kind].GetType().Name} " +
                    $"and {source.GetType().Name}.");
            }
        }

        Kinds = [.. _sources.Keys];
    }

    /// <summary>Every kind a source claims.</summary>
    public IReadOnlyCollection<string> Kinds { get; }

    /// <summary>The source owning a kind.</summary>
    /// <exception cref="UnknownTrashKindException">No source claims the kind.</exception>
    public ITrashSource Resolve(string kind) =>
        _sources.TryGetValue(kind, out var source) ? source : throw new UnknownTrashKindException(kind);

    /// <summary>Whether a source in this build claims the kind.</summary>
    public bool Knows(string kind) => _sources.ContainsKey(kind);
}
