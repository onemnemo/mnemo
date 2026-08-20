using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Controls;
using Avalonia.VisualTree;
using Mnemo.Core.Models;

namespace Mnemo.UI.Components.BlockEditor;

/// <summary>A heading surfaced in the note index (outline) popover.</summary>
public sealed record BlockOutlineEntry(string BlockId, string Text, BlockType Type);

public partial class BlockEditor
{
    /// <summary>
    /// Top-level heading blocks (H1-H4) in document order, for the note index popover.
    /// Empty-text headings are skipped.
    /// </summary>
    public IReadOnlyList<BlockOutlineEntry> GetHeadingOutline()
    {
        var entries = new List<BlockOutlineEntry>();
        for (var i = 0; i < Blocks.Count; i++)
        {
            var block = Blocks[i];
            if (block.Type is not (BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4))
                continue;

            var text = block.Content?.Trim();
            if (!string.IsNullOrEmpty(text))
                entries.Add(new BlockOutlineEntry(block.Id, text, block.Type));
        }
        return entries;
    }

    /// <summary>Index of the given block among top-level blocks, or -1. Used for proportional scroll fallback.</summary>
    public int GetTopLevelBlockIndex(string blockId)
    {
        for (var i = 0; i < Blocks.Count; i++)
        {
            if (Blocks[i].Id == blockId)
                return i;
        }
        return -1;
    }

    public int TopLevelBlockCount => Blocks.Count;

    /// <summary>Breathing room above a block scrolled to the top of the viewport.</summary>
    private const double ScrollToBlockTopPadding = 24;

    /// <summary>
    /// Scrolls so the given block sits at the top of the viewport (index navigation).
    /// Returns false when the block is missing or its row is not realized (virtualized
    /// out); callers can then scroll proportionally and retry.
    /// </summary>
    public bool ScrollToBlock(string blockId)
    {
        var block = BlockHierarchy.FindById(Blocks, blockId);
        if (block == null)
            return false;

        var editable = GetEditableBlockForViewModel(block);
        if (editable == null)
            return false;

        var scroll = this.FindAncestorOfType<ScrollViewer>();
        // TranslatePoint goes through the render transform chain, so camera zoom is accounted for.
        var viewportPoint = scroll == null ? null : editable.TranslatePoint(new Point(0, 0), scroll);
        if (scroll == null || viewportPoint == null)
        {
            editable.BringIntoView();
            return true;
        }

        var targetY = scroll.Offset.Y + viewportPoint.Value.Y - ScrollToBlockTopPadding;
        var scrollable = Math.Max(0, scroll.Extent.Height - scroll.Viewport.Height);
        scroll.Offset = scroll.Offset.WithY(Math.Clamp(targetY, 0, scrollable));
        return true;
    }
}
