using System;
using System.Collections.Generic;

namespace Mnemo.Infrastructure.Services.MindmapV2.Persistence;

/// <summary>One element's searchable text row in the FTS mirror.</summary>
public sealed record MindmapSearchEntry(string ElementId, string Text);

/// <summary>A match returned from an in-map FTS query.</summary>
public sealed record MindmapSearchHit(string ElementId, string Text);

/// <summary>
/// The incremental change to a document's FTS mirror produced by one commit. For a full document write
/// (create, import, repair) set <see cref="FullReplace"/> and list every element in <see cref="Upserts"/>;
/// for an edit batch, list only the elements the batch touched and removed.
/// </summary>
public sealed record MindmapSearchDelta
{
    public IReadOnlyList<MindmapSearchEntry> Upserts { get; init; } = Array.Empty<MindmapSearchEntry>();

    public IReadOnlyList<string> Removed { get; init; } = Array.Empty<string>();

    /// <summary>When true, all existing FTS rows for the map are cleared before the upserts are applied.</summary>
    public bool FullReplace { get; init; }
}
