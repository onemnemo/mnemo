using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

/// <summary>An Anki image occlusion note's shapes as a Mnemo mask document, plus what the move left behind.</summary>
/// <param name="TextLabels">Text shapes in reading order, to be shown on Back.</param>
/// <param name="RotatedShapes">Rotated rectangles and ellipses, which Mnemo keeps unrotated.</param>
internal sealed record AnkiOcclusionMapped(
    string MasksJson,
    IReadOnlyDictionary<string, int> OrdinalByKey,
    IReadOnlyList<string> TextLabels,
    int RotatedShapes);

/// <summary>Turns parsed Anki shapes into masks, groups and card keys.</summary>
internal static class AnkiOcclusionMapper
{
    private const int IdLength = 12;

    /// <summary>Null when no shape can become a mask, so the note can still import as plain cards.</summary>
    public static AnkiOcclusionMapped? Map(long noteId, IReadOnlyList<AnkiOcclusionShape> shapes)
    {
        var labels = shapes
            .Where(s => s.Kind == AnkiShapeKind.Text && !string.IsNullOrWhiteSpace(s.Text))
            .OrderBy(s => s.Top)
            .ThenBy(s => s.Left)
            .Select(s => s.Text.Trim())
            .ToArray();

        // Ordinal 0 draws a shape on every card and makes none of its own, so it has no mask to ask.
        var entries = shapes
            .Where(s => s.Kind != AnkiShapeKind.Text)
            .SelectMany(s => s.Ordinals.Where(o => o > 0).Select(o => (Shape: s, Ordinal: o)))
            .OrderBy(e => e.Ordinal)
            .ThenBy(e => e.Shape.Index)
            .ToArray();

        var groups = entries.GroupBy(e => e.Ordinal).ToDictionary(g => g.Key, g => IdFor(noteId, g.First()));
        var counts = entries.GroupBy(e => e.Ordinal).ToDictionary(g => g.Key, g => g.Count());
        var masks = new List<OcclusionMask>();
        var ordinalById = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            var id = IdFor(noteId, entry);
            ordinalById[id] = entry.Ordinal;
            masks.Add(MaskFor(entry.Shape, id, counts[entry.Ordinal] > 1 ? groups[entry.Ordinal] : null, masks.Count));
        }

        // The shared parser clamps and drops what it cannot hold, so the keys below are those of
        // the masks that will really be stored.
        var mode = shapes.Any(s => s.OccludeInactive) ? FlashcardOcclusion.HideAll : FlashcardOcclusion.HideOne;
        var stored = FlashcardOcclusion.Parse(FlashcardOcclusion.Serialize(new OcclusionDocument(mode, masks)));
        var json = FlashcardOcclusion.Serialize(stored);
        if (stored.Masks.Count == 0)
            return null;

        var keys = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var unit in FlashcardOcclusionUnits.Build(stored).Units)
            keys[unit.Key] = ordinalById[unit.Members[0].Id];

        var rotated = entries.Count(e => e.Shape.Kind is AnkiShapeKind.Rect or AnkiShapeKind.Ellipse && e.Shape.Angle != 0);
        return new AnkiOcclusionMapped(json, keys, labels, rotated);
    }

    /// <summary>Ids come from the note and the shape's place in it, so a repeat import gives the same card keys.</summary>
    private static string IdFor(long noteId, (AnkiOcclusionShape Shape, int Ordinal) entry)
    {
        var seed = string.Create(CultureInfo.InvariantCulture, $"io:{noteId}:{entry.Shape.Index}:{entry.Ordinal}");
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(seed)))[..IdLength];
    }

    private static OcclusionMask MaskFor(AnkiOcclusionShape shape, string id, string? group, int order)
    {
        if (shape.Kind != AnkiShapeKind.Polygon)
        {
            var name = shape.Kind == AnkiShapeKind.Rect ? FlashcardOcclusion.Rect : FlashcardOcclusion.Ellipse;
            return new OcclusionMask(id, name, shape.Left, shape.Top, shape.Width, shape.Height, null, null, group, order);
        }

        // Anki draws a moved polygon's stored points shifted by how far its box moved from them.
        var dx = shape.Left - shape.Points.Min(p => p[0]);
        var dy = shape.Top - shape.Points.Min(p => p[1]);
        var points = shape.Points.Select(p => new[] { p[0] + dx, p[1] + dy }).ToArray();
        var minX = points.Min(p => p[0]);
        var minY = points.Min(p => p[1]);
        return new OcclusionMask(
            id, FlashcardOcclusion.Polygon, minX, minY, points.Max(p => p[0]) - minX, points.Max(p => p[1]) - minY,
            points, null, group, order);
    }
}
