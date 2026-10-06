using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Mnemo.Core.Models.Flashcards;

/// <summary>One covered region of an image, in fractions of the image (0 to 1).</summary>
/// <param name="Id">Never reused within a fact, since an ungrouped mask's card key comes from it.</param>
/// <param name="Group">Opaque label shared by masks asked as one card, so membership changes keep the card key.</param>
public sealed record OcclusionMask(
    string Id,
    string Shape,
    double X,
    double Y,
    double W,
    double H,
    IReadOnlyList<double[]>? Points,
    string? Label,
    string? Group,
    int Order);

/// <summary>The masks of one fact and whether a card hides every mask or only the asked one.</summary>
public sealed record OcclusionDocument(string Mode, IReadOnlyList<OcclusionMask> Masks)
{
    /// <summary>A document with no masks, which is what unreadable content parses to.</summary>
    public static OcclusionDocument Empty { get; } = new(FlashcardOcclusion.HideAll, []);
}

/// <summary>The stored form of a fact's masks: one JSON document in the Masks field. The web keeps a matching copy.</summary>
public static class FlashcardOcclusion
{
    public const string HideAll = "hideAll";
    public const string HideOne = "hideOne";

    public const string Rect = "rect";
    public const string Ellipse = "ellipse";
    public const string Polygon = "polygon";

    /// <summary>The only schema version this build reads or writes.</summary>
    public const int Version = 1;

    /// <summary>Masks beyond this many in a document are ignored on read.</summary>
    public const int MaxMasks = 300;

    /// <summary>Polygon vertices beyond this many are ignored on read.</summary>
    public const int MaxPoints = 100;

    /// <summary>Longest Masks field value a save accepts, in characters.</summary>
    public const int MaxFieldLength = 200_000;

    private const int IdMaxLength = 16;
    private static readonly Regex ControlChars = new(@"\p{Cc}", RegexOptions.Compiled);
    private const double Scale = 10_000d;

    /// <summary>Reads a Masks field value. Anything unreadable gives fewer masks, never an exception.</summary>
    public static OcclusionDocument Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return OcclusionDocument.Empty;

        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return OcclusionDocument.Empty;

            if (root.TryGetProperty("v", out var v) && !(v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n) && n == Version))
                return OcclusionDocument.Empty;

            var mode = root.TryGetProperty("mode", out var m) && m.ValueKind == JsonValueKind.String
                && m.GetString() == HideOne
                    ? HideOne
                    : HideAll;

            var masks = new List<OcclusionMask>();
            if (root.TryGetProperty("masks", out var list) && list.ValueKind == JsonValueKind.Array)
            {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                var index = 0;
                foreach (var item in list.EnumerateArray())
                {
                    if (masks.Count >= MaxMasks)
                        break;

                    var mask = ReadMask(item, index++);
                    if (mask is not null && seen.Add(mask.Id))
                        masks.Add(mask);
                }
            }

            return new OcclusionDocument(mode, masks);
        }
        catch (JsonException)
        {
            return OcclusionDocument.Empty;
        }
    }

    /// <summary>How many entries the masks array holds before any is read, so a caller can tell when <see cref="Parse"/> dropped some.</summary>
    public static int CountWritten(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return 0;

        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("masks", out var list) && list.ValueKind == JsonValueKind.Array
                    ? list.GetArrayLength()
                    : 0;
        }
        catch (JsonException)
        {
            return 0;
        }
    }

    /// <summary>Writes a document in the canonical form <see cref="Parse"/> reads back unchanged.</summary>
    /// <remarks>Byte for byte what the web's JSON.stringify writes for the same document.</remarks>
    public static string Serialize(OcclusionDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var sb = new StringBuilder();
        sb.Append("{\"v\":").Append(Version).Append(",\"mode\":");
        AppendString(sb, document.Mode == HideOne ? HideOne : HideAll);
        sb.Append(",\"masks\":[");
        var first = true;
        foreach (var mask in document.Masks)
        {
            if (!first)
                sb.Append(',');
            first = false;
            AppendMask(sb, mask);
        }

        return sb.Append("]}").ToString();
    }

    /// <summary>Whether a string can be a mask id or a group label, which become part of a card key.</summary>
    public static bool IsValidId(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > IdMaxLength)
            return false;

        foreach (var c in value)
        {
            if (!(c is >= 'a' and <= 'z' || c is >= '0' and <= '9'))
                return false;
        }

        return true;
    }

    private static void AppendMask(StringBuilder sb, OcclusionMask mask)
    {
        sb.Append("{\"id\":");
        AppendString(sb, mask.Id);
        sb.Append(",\"shape\":");
        AppendString(sb, mask.Shape);
        sb.Append(",\"x\":").Append(Format(mask.X));
        sb.Append(",\"y\":").Append(Format(mask.Y));
        sb.Append(",\"w\":").Append(Format(mask.W));
        sb.Append(",\"h\":").Append(Format(mask.H));
        if (mask.Points is { Count: > 0 })
        {
            sb.Append(",\"points\":[");
            for (var i = 0; i < mask.Points.Count; i++)
            {
                if (i > 0)
                    sb.Append(',');
                sb.Append('[').Append(Format(mask.Points[i][0])).Append(',').Append(Format(mask.Points[i][1])).Append(']');
            }

            sb.Append(']');
        }

        if (!string.IsNullOrEmpty(mask.Label))
        {
            sb.Append(",\"label\":");
            AppendString(sb, mask.Label);
        }

        if (!string.IsNullOrEmpty(mask.Group))
        {
            sb.Append(",\"group\":");
            AppendString(sb, mask.Group);
        }

        sb.Append(",\"order\":").Append(mask.Order.ToString(CultureInfo.InvariantCulture)).Append('}');
    }

    /// <summary>A rounded number as JSON.stringify writes it; adding zero turns -0 into 0.</summary>
    private static string Format(double value) =>
        (Round(value) + 0d).ToString("R", CultureInfo.InvariantCulture);

    /// <summary>Escapes only what JSON.stringify does, so text such as emoji stays raw.</summary>
    private static void AppendString(StringBuilder sb, string value)
    {
        sb.Append('"');
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20 || (char.IsSurrogate(c) && !PairedSurrogate(value, i)))
                        sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else
                        sb.Append(c);
                    break;
            }
        }

        sb.Append('"');
    }

    private static bool PairedSurrogate(string value, int i) =>
        char.IsHighSurrogate(value[i])
            ? i + 1 < value.Length && char.IsLowSurrogate(value[i + 1])
            : i > 0 && char.IsHighSurrogate(value[i - 1]);

    /// <summary>Trims what a script's trim does, which also takes the byte order mark.</summary>
    private static string TrimText(string value)
    {
        var start = 0;
        var end = value.Length;
        while (start < end && IsTrimmable(value[start]))
            start++;
        while (end > start && IsTrimmable(value[end - 1]))
            end--;
        return value[start..end];
    }

    private static bool IsTrimmable(char c) => char.IsWhiteSpace(c) || c == '﻿';

    private static OcclusionMask? ReadMask(JsonElement item, int index)
    {
        if (item.ValueKind != JsonValueKind.Object)
            return null;

        var id = Text(item, "id");
        if (!IsValidId(id))
            return null;

        var shape = Text(item, "shape");
        if (shape is not (Rect or Ellipse or Polygon))
            return null;

        var label = Text(item, "label") is { } rawLabel ? TrimText(ControlChars.Replace(rawLabel, " ")) : null;
        var group = Text(item, "group");
        var order = item.TryGetProperty("order", out var o) && o.ValueKind == JsonValueKind.Number
            && o.TryGetDouble(out var od) && Math.Abs(od) < int.MaxValue
                ? (int)od
                : index;

        double x, y, w, h;
        IReadOnlyList<double[]>? points = null;
        if (shape == Polygon)
        {
            points = ReadPoints(item);
            if (points is null)
                return null;

            x = points.Min(p => p[0]);
            y = points.Min(p => p[1]);
            w = points.Max(p => p[0]) - x;
            h = points.Max(p => p[1]) - y;
        }
        else
        {
            if (!Number(item, "x", out x) || !Number(item, "y", out y)
                || !Number(item, "w", out w) || !Number(item, "h", out h))
                return null;

            x = Clamp(x);
            y = Clamp(y);
            w = Math.Min(Clamp(w), 1 - x);
            h = Math.Min(Clamp(h), 1 - y);
        }

        x = Round(x);
        y = Round(y);
        w = Round(w);
        h = Round(h);
        if (w <= 0 || h <= 0)
            return null;

        return new OcclusionMask(
            id!, shape, x, y, w, h, points,
            string.IsNullOrEmpty(label) ? null : label,
            IsValidId(group) ? group : null,
            order);
    }

    private static IReadOnlyList<double[]>? ReadPoints(JsonElement item)
    {
        if (!item.TryGetProperty("points", out var raw) || raw.ValueKind != JsonValueKind.Array)
            return null;

        var points = new List<double[]>();
        foreach (var pair in raw.EnumerateArray())
        {
            if (points.Count >= MaxPoints)
                break;
            if (pair.ValueKind != JsonValueKind.Array || pair.GetArrayLength() != 2)
                return null;

            var a = pair[0];
            var b = pair[1];
            if (a.ValueKind != JsonValueKind.Number || b.ValueKind != JsonValueKind.Number
                || !a.TryGetDouble(out var px) || !b.TryGetDouble(out var py)
                || !double.IsFinite(px) || !double.IsFinite(py))
                return null;

            points.Add([Round(Clamp(px)), Round(Clamp(py))]);
        }

        return points.Count >= 3 ? points : null;
    }

    private static string? Text(JsonElement item, string name) =>
        item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool Number(JsonElement item, string name, out double value)
    {
        value = 0;
        return item.TryGetProperty(name, out var raw) && raw.ValueKind == JsonValueKind.Number
            && raw.TryGetDouble(out value) && double.IsFinite(value);
    }

    private static double Clamp(double value) => double.IsFinite(value) ? Math.Clamp(value, 0, 1) : 0;

    /// <summary>Rounds to four decimals, the precision a stored coordinate keeps.</summary>
    public static double Round(double value) => Math.Round(value * Scale, MidpointRounding.AwayFromZero) / Scale;
}
