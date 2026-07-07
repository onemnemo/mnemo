using System.Text.Json;

namespace Mnemo.Core.Models.MindmapV2;

/// <summary>
/// Fallback content for an unknown <c>$type</c> discriminator (e.g. a document written by a newer app
/// version or a since-removed plugin). It captures the original discriminator and the raw JSON so the
/// element round-trips losslessly instead of failing to load or dropping data.
/// </summary>
public sealed record PlaceholderContent : IElementContent
{
    /// <summary>The original, unrecognized <c>$type</c> value.</summary>
    public required string OriginalType { get; init; }

    /// <summary>The verbatim JSON payload, re-emitted unchanged on serialization.</summary>
    public required JsonElement Raw { get; init; }

    public string TypeDiscriminator => OriginalType;
}
