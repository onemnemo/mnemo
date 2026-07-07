using System;

namespace Mnemo.Core.Models.MindmapV2;

// Content payloads for tree nodes (ElementKind.Node). Grouped in one file because they form a single
// polymorphic family (a discriminated union over IElementContent). Cross-document references
// (flashcard/note) store the referenced entity's own GUID and resolve lazily at render time.

/// <summary>Default node: markdown inline subset (bold/italic/code/links).</summary>
public sealed record TextContent : IElementContent
{
    public string Text { get; init; } = string.Empty;

    public string TypeDiscriminator => ElementContentDiscriminators.Text;
}

/// <summary>An image inside the tree. Stored via the image asset service, never inline bytes.</summary>
public sealed record ImageContent : IElementContent
{
    public required string AssetId { get; init; }

    public string? Caption { get; init; }

    public string TypeDiscriminator => ElementContentDiscriminators.Image;
}

/// <summary>External web link; rendered as a favicon + title chip.</summary>
public sealed record LinkContent : IElementContent
{
    public required string Url { get; init; }

    public string? Title { get; init; }

    public string TypeDiscriminator => ElementContentDiscriminators.Link;
}

/// <summary>Live reference to a flashcard deck (and optionally a card). Resolves lazily at render time.</summary>
public sealed record FlashcardContent : IElementContent
{
    public required string DeckId { get; init; }

    public string? CardId { get; init; }

    public string TypeDiscriminator => ElementContentDiscriminators.Flashcard;
}

/// <summary>Live reference to a note (and optionally a block). Resolves lazily at render time.</summary>
public sealed record NoteContent : IElementContent
{
    public required string NoteId { get; init; }

    public string? BlockId { get; init; }

    public string TypeDiscriminator => ElementContentDiscriminators.Note;
}

/// <summary>Checkbox node for planning maps.</summary>
public sealed record TaskContent : IElementContent
{
    public string Text { get; init; } = string.Empty;

    public bool Done { get; init; }

    public DateTime? Due { get; init; }

    public string TypeDiscriminator => ElementContentDiscriminators.Task;
}

/// <summary>Monospace snippet card.</summary>
public sealed record CodeContent : IElementContent
{
    public string Language { get; init; } = string.Empty;

    public string Source { get; init; } = string.Empty;

    public string TypeDiscriminator => ElementContentDiscriminators.Code;
}

/// <summary>Rendered LaTeX.</summary>
public sealed record MathContent : IElementContent
{
    public string Latex { get; init; } = string.Empty;

    public string TypeDiscriminator => ElementContentDiscriminators.Math;
}
