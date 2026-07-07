using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.MindmapV2;

/// <summary>
/// A map as seen by the library/overview page: the full document (for counts and previews) plus its
/// library organization metadata (folder membership and linked decks). Keeps organization concerns off
/// the pure <see cref="MindmapDocument"/> model while giving the overview everything it renders in one read.
/// </summary>
public sealed record MindmapLibraryEntry
{
    public required MindmapDocument Document { get; init; }

    /// <summary>Owning folder id, or null when the map lives at the library root.</summary>
    public string? FolderId { get; init; }

    /// <summary>Flashcard deck ids linked to this map; their due counts surface as a library badge.</summary>
    public IReadOnlyList<string> LinkedDeckIds { get; init; } = Array.Empty<string>();
}
