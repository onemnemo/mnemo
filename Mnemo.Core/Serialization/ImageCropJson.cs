using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using Mnemo.Core.Models;

namespace Mnemo.Core.Serialization;

/// <summary>
/// The one reading of a stored <see cref="ImageCrop"/>, shared by the note block reader and the mindmap
/// store. Anything absent, mistyped, out of range or degenerate reads as no crop, because the five
/// numbers are a window and mean nothing apart.
/// </summary>
public static class ImageCropJson
{
    /// <summary>
    /// The floor below which <c>w</c>, <c>h</c> or <c>aspect</c> stops being a real crop. The Typst
    /// emitter divides by all three and rounds anything under 5e-7 to a literal zero. Matches the web
    /// reader's floor.
    /// </summary>
    public const double MinFraction = 1e-6;

    /// <summary>A crop out of a JSON object, or null when it is not a usable one. Never throws.</summary>
    public static ImageCrop? Read(JsonElement crop)
    {
        if (crop.ValueKind != JsonValueKind.Object)
            return null;

        if (!TryReadFraction(crop, "x", out var x)
            || !TryReadFraction(crop, "y", out var y)
            || !TryReadFraction(crop, "w", out var w)
            || !TryReadFraction(crop, "h", out var h))
            return null;

        if (w < MinFraction || h < MinFraction)
            return null;

        if (!InlineSpanJson.TryGetPropertyCaseInsensitive(crop, "aspect", out var aspectEl)
            || aspectEl.ValueKind != JsonValueKind.Number
            || !aspectEl.TryGetDouble(out var aspect)
            || double.IsNaN(aspect)
            || double.IsInfinity(aspect)
            || aspect < MinFraction)
            return null;

        return new ImageCrop(x, y, w, h, aspect);
    }

    /// <summary>Writes the crop as an object. Property order matches the web serializer's.</summary>
    public static void Write(Utf8JsonWriter writer, ImageCrop crop)
    {
        writer.WriteStartObject();
        writer.WriteNumber("x", crop.X);
        writer.WriteNumber("y", crop.Y);
        writer.WriteNumber("w", crop.W);
        writer.WriteNumber("h", crop.H);
        writer.WriteNumber("aspect", crop.Aspect);
        writer.WriteEndObject();
    }

    private static bool TryReadFraction(JsonElement crop, string propertyName, out double value)
    {
        value = 0;
        if (!InlineSpanJson.TryGetPropertyCaseInsensitive(crop, propertyName, out var el)
            || el.ValueKind != JsonValueKind.Number
            || !el.TryGetDouble(out var raw)
            || double.IsNaN(raw)
            || raw < 0
            || raw > 1)
            return false;

        value = raw;
        return true;
    }
}

/// <summary>
/// <see cref="ImageCrop"/> through <see cref="ImageCropJson"/>, for documents serialized as a whole. A
/// crop that does not check out is read as null instead of failing the document it sits in.
/// </summary>
public sealed class ImageCropJsonConverter : JsonConverter<ImageCrop>
{
    public override ImageCrop? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        return ImageCropJson.Read(document.RootElement);
    }

    public override void Write(Utf8JsonWriter writer, ImageCrop value, JsonSerializerOptions options) =>
        ImageCropJson.Write(writer, value);
}
