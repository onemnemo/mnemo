using System;
using System.Collections.Generic;
using System.IO;
using Avalonia.Media.Imaging;
using Mnemo.Core.Models;

namespace Mnemo.UI.Components.BlockEditor;

/// <summary>
/// Estimates block-row heights for ItemsRepeater virtualization. Tall rows (images, sketches)
/// must not be estimated as average text height when virtualized out, or scroll extent and
/// item positions drift, especially under camera zoom.
/// </summary>
internal static class BlockRowLayoutHeights
{
    public const double RowSpacing = 6;
    public const double BelowBlocksArea = 56;
    private const double TextRowFallback = 34;
    private const double ImagePlaceholderHeight = 160;
    private const double ImageMaxHeight = 600;
    private const double ImageHitPadding = 12;
    private const double CaptionRowMargin = 4;
    private const double DefaultCaptionHeight = 22;
    private const double SketchDefaultHeight = 280;

    private static readonly Dictionary<string, (int W, int H)> PixelSizeCache = new(StringComparer.OrdinalIgnoreCase);

    public static void Refresh(BlockRowViewModelBase row, double contentColumnWidth)
    {
        var height = row switch
        {
            SingleBlockRowViewModel single => EstimateBlockHeight(single.Block, contentColumnWidth),
            SplitBlockRowViewModel split => EstimateSplitRowHeight(split, contentColumnWidth),
            _ => 0
        };
        row.SetLayoutHeightHint(height);
    }

    public static double ResolveRowHeight(BlockRowViewModelBase row, IReadOnlyDictionary<BlockRowViewModelBase, double> measuredHeights)
    {
        var hint = row.LayoutHeightHint;
        if (measuredHeights.TryGetValue(row, out var measured) && measured > hint)
            hint = measured;
        return hint > 1 ? hint : TextRowFallback;
    }

    public static double EstimateBlockHeight(BlockViewModel block, double contentColumnWidth)
    {
        return block.Type switch
        {
            BlockType.Image => EstimateImageRowHeight(block, contentColumnWidth),
            BlockType.Sketch => EstimateSketchRowHeight(block),
            BlockType.Code => EstimateCodeRowHeight(block),
            BlockType.Divider => 24,
            _ => 0
        };
    }

    private static double EstimateSplitRowHeight(SplitBlockRowViewModel split, double contentColumnWidth)
    {
        var colW = Math.Max(48, contentColumnWidth * 0.5 - 6);
        var left = 0.0;
        foreach (var b in split.TwoColumn.LeftColumnBlocks)
            left += EstimateBlockHeight(b, colW) + RowSpacing;
        if (split.TwoColumn.LeftColumnBlocks.Count > 0)
            left -= RowSpacing;
        left += 8;

        var right = 0.0;
        foreach (var b in split.TwoColumn.RightColumnBlocks)
            right += EstimateBlockHeight(b, colW) + RowSpacing;
        if (split.TwoColumn.RightColumnBlocks.Count > 0)
            right -= RowSpacing;
        right += 8;

        return Math.Max(left, right);
    }

    private static double EstimateImageRowHeight(BlockViewModel block, double contentColumnWidth)
    {
        var caption = EstimateCaptionHeight(block.Content);
        if (string.IsNullOrEmpty(block.ImagePath) || !File.Exists(block.ImagePath))
            return ImagePlaceholderHeight + CaptionRowMargin + caption;

        var displayWidth = ResolveImageDisplayWidth(block, contentColumnWidth);
        var displayHeight = ResolveImageDisplayHeight(block.ImagePath, displayWidth);
        return displayHeight + ImageHitPadding + CaptionRowMargin + caption;
    }

    private static double EstimateSketchRowHeight(BlockViewModel block)
    {
        var width = block.SketchWidth > 0 ? block.SketchWidth : 400;
        return Math.Min(600, width * 0.65) + CaptionRowMargin + DefaultCaptionHeight;
    }

    private static double EstimateCodeRowHeight(BlockViewModel block)
    {
        var lines = string.IsNullOrEmpty(block.Content) ? 1 : block.Content.Split('\n').Length;
        return Math.Clamp(lines, 1, 40) * 20 + 24;
    }

    private static double EstimateCaptionHeight(string? content)
    {
        if (string.IsNullOrWhiteSpace(content))
            return DefaultCaptionHeight;
        var lines = content.Split('\n').Length;
        return Math.Clamp(lines, 1, 6) * 18 + 4;
    }

    private static double ResolveImageDisplayWidth(BlockViewModel block, double contentColumnWidth)
    {
        var maxW = Math.Clamp(contentColumnWidth - ImageHitPadding, 80, 1600);
        if (block.ImageWidth > 0)
            return Math.Min(block.ImageWidth, maxW);
        return maxW;
    }

    private static double ResolveImageDisplayHeight(string path, double displayWidth)
    {
        if (!TryGetImagePixelSize(path, out var px))
            return Math.Min(ImageMaxHeight, displayWidth * 0.75);

        if (px.W <= 0 || px.H <= 0)
            return Math.Min(ImageMaxHeight, displayWidth * 0.75);

        var aspectHeight = displayWidth * ((double)px.H / px.W);
        return Math.Min(ImageMaxHeight, aspectHeight);
    }

    private static bool TryGetImagePixelSize(string path, out (int W, int H) px)
    {
        if (PixelSizeCache.TryGetValue(path, out px))
            return true;

        try
        {
            using var bmp = new Bitmap(path);
            px = (bmp.PixelSize.Width, bmp.PixelSize.Height);
            PixelSizeCache[path] = px;
            return true;
        }
        catch
        {
            px = default;
            return false;
        }
    }
}
