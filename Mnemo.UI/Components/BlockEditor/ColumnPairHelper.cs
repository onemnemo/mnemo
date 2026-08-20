using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text.Json;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.UI.Components.BlockEditor;

/// <summary>Legacy flat pair: two consecutive top-level blocks share <c>columnPairId</c> + <c>columnSide</c> meta (merged into <see cref="TwoColumnBlockViewModel"/> on load). Canonical model is nested <see cref="BlockType.TwoColumn"/> + <see cref="TwoColumnPayload"/>.</summary>
public static class ColumnPairHelper
{
    public const string PairIdKey = "columnPairId";
    public const string SideKey = "columnSide";
    public const string Left = "Left";
    public const string Right = "Right";

    public static string? GetPairId(BlockViewModel vm) => MetaString(vm, PairIdKey);

    /// <summary><see cref="Left"/> or <see cref="Right"/> when paired.</summary>
    public static string? GetColumnSide(BlockViewModel vm) => MetaString(vm, SideKey);

    private static string? MetaString(BlockViewModel vm, string key)
    {
        if (!vm.Meta.TryGetValue(key, out var v) || v == null) return null;
        return v.ToString();
    }

    public static bool IsPairedLeft(BlockViewModel vm, int index, IReadOnlyList<BlockViewModel> blocks) =>
        GetColumnSide(vm) == Left
        && index + 1 < blocks.Count
        && GetPairId(vm) == GetPairId(blocks[index + 1])
        && GetColumnSide(blocks[index + 1]) == Right;

    public static bool IsPairedRight(BlockViewModel vm, int index, IReadOnlyList<BlockViewModel> blocks) =>
        GetColumnSide(vm) == Right
        && index > 0
        && GetPairId(vm) == GetPairId(blocks[index - 1])
        && GetColumnSide(blocks[index - 1]) == Left;

    public static BlockViewModel? GetSibling(BlockViewModel vm, IReadOnlyList<BlockViewModel> document)
    {
        var pairId = GetPairId(vm);
        if (string.IsNullOrEmpty(pairId)) return null;
        var idx = -1;
        for (int i = 0; i < document.Count; i++)
        {
            if (ReferenceEquals(document[i], vm))
            {
                idx = i;
                break;
            }
        }
        if (idx < 0) return null;
        if (GetColumnSide(vm) == Left && idx + 1 < document.Count
            && GetPairId(document[idx + 1]) == pairId && GetColumnSide(document[idx + 1]) == Right)
            return document[idx + 1];
        if (GetColumnSide(vm) == Right && idx > 0
            && GetPairId(document[idx - 1]) == pairId && GetColumnSide(document[idx - 1]) == Left)
            return document[idx - 1];
        return null;
    }

    public static void WirePair(BlockViewModel left, BlockViewModel right, string pairId, double splitRatio = 0.5)
    {
        left.Meta[PairIdKey] = pairId;
        left.Meta[SideKey] = Left;
        left.Meta["columnSplitRatio"] = Math.Clamp(splitRatio, 0.1, 0.9);
        right.Meta[PairIdKey] = pairId;
        right.Meta[SideKey] = Right;
        right.Meta.Remove("columnSplitRatio");
    }

    public static void ClearPair(BlockViewModel? a, BlockViewModel? b)
    {
        if (a != null)
        {
            a.Meta.Remove(PairIdKey);
            a.Meta.Remove(SideKey);
            a.Meta.Remove("columnSplitRatio");
        }
        if (b != null)
        {
            b.Meta.Remove(PairIdKey);
            b.Meta.Remove(SideKey);
            b.Meta.Remove("columnSplitRatio");
        }
    }

    /// <summary>True when <paramref name="b"/> is persisted nested split (two <see cref="BlockType.ColumnGroup"/> columns).</summary>
    public static bool IsNestedTwoColumnBlock(Block b) =>
        b.Type == BlockType.TwoColumn
        && b.Children is { Count: >= 2 }
        && b.Children[0].Type == BlockType.ColumnGroup
        && b.Children[1].Type == BlockType.ColumnGroup;

    /// <summary>Normalizes legacy <see cref="BlockType.TwoColumn"/> rows (non-<see cref="BlockType.ColumnGroup"/> children) into nested column groups + <see cref="TwoColumnPayload"/>. Already-nested splits pass through.</summary>
    public static List<Block> ExpandLegacyTwoColumnBlocks(IEnumerable<Block> blocks)
    {
        var list = new List<Block>();
        foreach (var b in blocks.Where(x => x != null).OrderBy(x => x.Order))
        {
            if (IsNestedTwoColumnBlock(b))
            {
                list.Add(b);
                continue;
            }

            if (b.Type == BlockType.TwoColumn && b.Children is { Count: >= 2 })
            {
                var ratio = ReadTwoColumnSplitRatio(b);
                var leftGroup = EnsureColumnGroupWrapper(CloneBlockForPairChild(b.Children[0]));
                var rightGroup = EnsureColumnGroupWrapper(CloneBlockForPairChild(b.Children[1]));
                list.Add(new Block
                {
                    Id = b.Id,
                    Type = BlockType.TwoColumn,
                    Order = b.Order,
                    Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) },
                    Payload = new TwoColumnPayload(ratio),
                    Meta = CopyMetaWithoutColumnLayout(b.Meta),
                    Children = new List<Block> { leftGroup, rightGroup }
                });
            }
            else
                list.Add(b);
        }
        return list;
    }

    /// <summary>Merge consecutive flat left/right pairs (pair meta) into <see cref="TwoColumnBlockViewModel"/> rows.</summary>
    public static void MergeConsecutiveColumnPairs(ObservableCollection<BlockViewModel> blocks)
    {
        for (var i = 0; i < blocks.Count - 1; i++)
        {
            if (!IsPairedLeft(blocks[i], i, blocks)) continue;
            var left = blocks[i];
            var right = blocks[i + 1];
            var tc = TwoColumnBlockViewModel.FromFlatPair(left, right);
            blocks.RemoveAt(i + 1);
            blocks[i] = tc;
        }
    }

    private static double ReadTwoColumnSplitRatio(Block b)
    {
        if (b.Payload is TwoColumnPayload tcp)
        {
            var r = tcp.SplitRatio;
            if (r <= 0 || r >= 1 || double.IsNaN(r))
                return 0.5;
            return Math.Clamp(r, 0.1, 0.9);
        }

        if (b.Meta != null && b.Meta.TryGetValue("columnSplitRatio", out var v) && v != null)
        {
            if (v is double d) return Math.Clamp(d, 0.1, 0.9);
            if (v is int i) return Math.Clamp(i, 0.1, 0.9);
            if (v is JsonElement je && je.ValueKind == JsonValueKind.Number)
                return Math.Clamp(je.GetDouble(), 0.1, 0.9);
        }

        return 0.5;
    }

    private static Dictionary<string, object> CopyMetaWithoutColumnLayout(Dictionary<string, object>? meta)
    {
        var d = new Dictionary<string, object>(meta ?? new Dictionary<string, object>());
        d.Remove("columnSplitRatio");
        d.Remove(PairIdKey);
        d.Remove(SideKey);
        return d;
    }

    private static Block EnsureColumnGroupWrapper(Block inner)
    {
        inner.EnsureSpans();
        if (inner.Type == BlockType.ColumnGroup)
            return inner;
        return new Block
        {
            Id = Guid.NewGuid().ToString(),
            Type = BlockType.ColumnGroup,
            Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) },
            Children = new List<Block> { inner }
        };
    }

    private static Block CloneBlockForPairChild(Block source)
    {
        source.EnsureSpans();
        return new Block
        {
            Id = string.IsNullOrEmpty(source.Id) ? Guid.NewGuid().ToString() : source.Id,
            Type = source.Type,
            Spans = new List<InlineSpan>(source.Spans),
            Payload = source.Payload,
            Meta = new Dictionary<string, object>(source.Meta ?? new Dictionary<string, object>()),
            Order = source.Order
        };
    }
}
