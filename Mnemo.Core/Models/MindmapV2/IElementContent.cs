namespace Mnemo.Core.Models.MindmapV2;

/// <summary>
/// Polymorphic payload for a <see cref="MindmapElement"/>. Concrete kinds carry a stable string
/// discriminator (serialized as <c>$type</c>). Unknown discriminators from newer document versions
/// deserialize to <see cref="PlaceholderContent"/> and round-trip losslessly, so documents never
/// lose data. The discriminator ⇄ type mapping and (de)serialization live in the Infrastructure
/// serializer rather than on attributes here, precisely so the unknown-type fallback is possible.
/// </summary>
public interface IElementContent
{
    /// <summary>Stable serialization discriminator for this content kind (the <c>$type</c> value).</summary>
    string TypeDiscriminator { get; }
}
