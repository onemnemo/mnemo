using System.Reflection;
using System.Text.Json.Nodes;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.SpanFixtureGen;

/// <summary>
/// Drives every ported operation through the real Mnemo.Core implementation
/// and records input/args/output as one fixture case per call. Two of the
/// operations exported from the TS port (splitAt, rangeHasFormat) correspond
/// to *private* helpers on InlineSpanFormatApplier -- reflection reaches them
/// without changing their accessibility, so Mnemo.Core stays untouched.
///
/// Reflection is used, rather than widening those methods to internal/public,
/// because Mnemo.Core is behavior-frozen for the duration of this port: its
/// public surface is not to be touched just to make a test harness's job
/// easier. The two MethodInfo lookups below run once, at class load (i.e.
/// before CaseBuilder.BuildAll's loop starts), specifically so a rename of
/// either private method fails fast here with the missing member's name
/// instead of surfacing as a null-reference deep inside the generation loop.
/// </summary>
public static class CaseBuilder
{
    private static readonly MethodInfo SplitAtBoundariesMethod =
        typeof(InlineSpanFormatApplier).GetMethod("SplitAtBoundaries", BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new MissingMethodException("InlineSpanFormatApplier.SplitAtBoundaries not found -- has it been renamed or removed?");

    private static readonly MethodInfo AllSpansInRangeHaveFormatMethod =
        typeof(InlineSpanFormatApplier).GetMethod("AllSpansInRangeHaveFormat", BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new MissingMethodException("InlineSpanFormatApplier.AllSpansInRangeHaveFormat not found -- has it been renamed or removed?");

    private static List<InlineSpan> SplitAtBoundaries(IReadOnlyList<InlineSpan> spans, int start, int end) =>
        (List<InlineSpan>)SplitAtBoundariesMethod.Invoke(null, [spans, start, end])!;

    private static bool AllSpansInRangeHaveFormat(
        IReadOnlyList<InlineSpan> spans, int start, int end, InlineFormatKind kind, string? color) =>
        (bool)AllSpansInRangeHaveFormatMethod.Invoke(null, [spans, start, end, kind, color])!;

    public static readonly string[] Operations =
    [
        "normalizeSpans", "flattenDisplay", "flattenForCaret", "caretLength",
        "sliceSpans", "splitAt", "rangeHasFormat", "replaceRange", "forceSubSup",
        "applyFormat", "applyTextEdit", "applyAutoLink",
    ];

    public static JsonArray BuildAll(ref SplitMix64 rng, int casesPerOp)
    {
        var all = new JsonArray();
        int index = 0;
        foreach (var op in Operations)
        {
            for (int i = 0; i < casesPerOp; i++)
            {
                all.Add(BuildCase(ref rng, op, index));
                index++;
            }
        }
        return all;
    }

    private static JsonObject BuildCase(ref SplitMix64 rng, string op, int index)
    {
        var spans = SpanSamples.BuildSpanList(ref rng, index);
        int total = InlineSpanText.LogicalLength(spans);

        var record = new JsonObject
        {
            ["index"] = index,
            ["op"] = op,
            ["spans"] = SpanWire.WriteSpans(spans),
        };

        switch (op)
        {
            case "normalizeSpans":
                record["args"] = new JsonObject();
                record["expected"] = Spans(InlineSpanFormatApplier.Normalize(spans));
                break;

            case "flattenDisplay":
                record["args"] = new JsonObject();
                record["expected"] = Value(InlineSpanText.FlattenDisplay(spans));
                break;

            case "flattenForCaret":
                record["args"] = new JsonObject();
                record["expected"] = Value(InlineSpanText.FlattenEditing(spans));
                break;

            case "caretLength":
                record["args"] = new JsonObject();
                record["expected"] = Value(total);
                break;

            case "sliceSpans":
            {
                var (start, end) = RangeSamples.PickRange(ref rng, total, spans);
                record["args"] = new JsonObject { ["start"] = start, ["end"] = end };
                record["expected"] = Spans(InlineSpanFormatApplier.SliceRuns(spans, start, end));
                break;
            }

            case "splitAt":
            {
                var (start, end) = RangeSamples.PickRange(ref rng, total, spans);
                record["args"] = new JsonObject { ["start"] = start, ["end"] = end };
                record["expected"] = Spans(SplitAtBoundaries(spans, start, end));
                break;
            }

            case "rangeHasFormat":
            {
                var (start, end) = RangeSamples.PickRange(ref rng, total, spans);
                var (kind, color) = SpanSamples.RandomFormatKindAndColor(ref rng);
                record["args"] = new JsonObject
                {
                    ["start"] = start, ["end"] = end, ["kind"] = SpanSamples.KindToWire(kind), ["color"] = color,
                };
                record["expected"] = Value(AllSpansInRangeHaveFormat(spans, start, end, kind, color));
                break;
            }

            case "replaceRange":
            {
                var (start, end) = RangeSamples.PickRange(ref rng, total, spans);
                // Offset the pool index so the insertion list is an independent draw, not a copy of `spans`.
                var insertion = SpanSamples.BuildSpanList(ref rng, index + 1_000_000);
                record["args"] = new JsonObject { ["start"] = start, ["end"] = end, ["insertion"] = SpanWire.WriteSpans(insertion) };
                record["expected"] = Spans(InlineSpanFormatApplier.ReplaceRange(spans, start, end, insertion));
                break;
            }

            case "forceSubSup":
            {
                var (start, end) = RangeSamples.PickRange(ref rng, total, spans);
                bool sub = rng.NextBool();
                bool sup = rng.NextBool();
                record["args"] = new JsonObject { ["start"] = start, ["end"] = end, ["sub"] = sub, ["sup"] = sup };
                record["expected"] = Spans(InlineSpanFormatApplier.ForceSubSup(spans, start, end, sub, sup));
                break;
            }

            case "applyFormat":
            {
                var (start, end) = RangeSamples.PickRange(ref rng, total, spans);
                var (kind, color) = SpanSamples.RandomFormatKindAndColor(ref rng);
                record["args"] = new JsonObject
                {
                    ["start"] = start, ["end"] = end, ["kind"] = SpanSamples.KindToWire(kind), ["color"] = color,
                };
                record["expected"] = Spans(InlineSpanFormatApplier.Apply(spans, start, end, kind, color));
                break;
            }

            case "applyTextEdit":
            {
                var (oldText, newText) = SpanSamples.RandomTextEditPair(ref rng, spans);
                record["args"] = new JsonObject { ["oldText"] = oldText, ["newText"] = newText };
                record["expected"] = Spans(InlineSpanFormatApplier.ApplyTextEdit(spans, oldText, newText));
                break;
            }

            case "applyAutoLink":
                record["args"] = new JsonObject();
                record["expected"] = Spans(InlineAutoLink.Apply(spans));
                break;

            default:
                throw new NotSupportedException(op);
        }

        return record;
    }

    private static JsonObject Spans(IReadOnlyList<InlineSpan> spans) => new() { ["spans"] = SpanWire.WriteSpans(spans) };

    private static JsonObject Value(string value) => new() { ["value"] = value };

    private static JsonObject Value(int value) => new() { ["value"] = value };

    private static JsonObject Value(bool value) => new() { ["value"] = value };
}
