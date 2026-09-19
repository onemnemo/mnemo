using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// System.Text.Json converter for <see cref="IElementContent"/>. Writes a <c>$type</c> discriminator
/// alongside the concrete payload and reads it back to the matching type. An unrecognized discriminator
/// deserializes to <see cref="PlaceholderContent"/>, capturing the raw JSON so documents from newer
/// versions (or removed plugins) round-trip losslessly instead of throwing or dropping data.
/// <para>
/// A stored <c>math</c> row is read as a text node holding one equation run. The math kind is retired
/// in favour of the inline equation atom, and reading it here, on the way in, is what makes every path
/// (the store, the trash, a package, a template, an edit op) see the one shape; the row is rewritten
/// as <c>text</c> the next time the document is saved. The discriminator itself is never renamed.
/// </para>
/// </summary>
public sealed class ElementContentJsonConverter : JsonConverter<IElementContent>
{
    private const string TypeProperty = "$type";

    // The one place discriminator strings bind to CLR types. PlaceholderContent is intentionally absent.
    // It is the fallback for anything not in this table.
    private static readonly IReadOnlyDictionary<string, Type> ByDiscriminator = new Dictionary<string, Type>(StringComparer.Ordinal)
    {
        [ElementContentDiscriminators.Text] = typeof(TextContent),
        [ElementContentDiscriminators.Image] = typeof(ImageContent),
        [ElementContentDiscriminators.Link] = typeof(LinkContent),
        [ElementContentDiscriminators.Flashcard] = typeof(FlashcardContent),
        [ElementContentDiscriminators.Note] = typeof(NoteContent),
        [ElementContentDiscriminators.Task] = typeof(TaskContent),
        [ElementContentDiscriminators.Code] = typeof(CodeContent),
        [ElementContentDiscriminators.Math] = typeof(MathContent),
        [ElementContentDiscriminators.Shape] = typeof(ShapeContent),
        [ElementContentDiscriminators.FreeText] = typeof(FreeTextContent),
        [ElementContentDiscriminators.CanvasImage] = typeof(CanvasImageContent),
        [ElementContentDiscriminators.Frame] = typeof(FrameContent),
    };

    public override IElementContent Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var doc = JsonDocument.ParseValue(ref reader);
        var root = doc.RootElement;

        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty(TypeProperty, out var typeProp) ||
            typeProp.ValueKind != JsonValueKind.String)
        {
            throw new JsonException($"Element content is missing a string \"{TypeProperty}\" discriminator.");
        }

        var discriminator = typeProp.GetString()!;
        if (ByDiscriminator.TryGetValue(discriminator, out var clrType))
        {
            var payload = (IElementContent?)JsonSerializer.Deserialize(root.GetRawText(), clrType, options);
            return payload switch
            {
                MathContent math => AsEquationNode(math),
                not null => payload,
                null => throw new JsonException($"Element content \"{discriminator}\" deserialized to null."),
            };
        }

        // Unknown discriminator: preserve verbatim. Clone() detaches the element from the disposed document.
        return new PlaceholderContent { OriginalType = discriminator, Raw = root.Clone() };
    }

    /// <summary>
    /// The text node a math row becomes: its LaTeX as one equation run, and as the plain text, since
    /// the source is what the row searched and exported as before.
    /// </summary>
    private static TextContent AsEquationNode(MathContent math) => new()
    {
        Text = math.Latex,
        Runs = new InlineSpan[] { new EquationSpan(math.Latex) },
    };

    public override void Write(Utf8JsonWriter writer, IElementContent value, JsonSerializerOptions options)
    {
        if (value is PlaceholderContent placeholder)
        {
            // Re-emit the captured JSON unchanged (it already carries its original $type).
            placeholder.Raw.WriteTo(writer);
            return;
        }

        writer.WriteStartObject();
        writer.WriteString(TypeProperty, value.TypeDiscriminator);

        // Serialize the concrete payload, then splice its members in, skipping the redundant
        // TypeDiscriminator projection (it is represented by $type). Serializing value.GetType() (concrete)
        // does not re-enter this converter, which only handles the IElementContent-typed slot.
        using var payload = JsonSerializer.SerializeToDocument(value, value.GetType(), options);
        foreach (var property in payload.RootElement.EnumerateObject())
        {
            if (property.NameEquals(TypeProperty) ||
                property.NameEquals("typeDiscriminator") ||
                property.NameEquals("TypeDiscriminator"))
            {
                continue;
            }

            property.WriteTo(writer);
        }

        writer.WriteEndObject();
    }
}
