using System.Collections.Generic;
using Avalonia.Controls;
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

    /// <summary>
    /// Brings the given block into view. Returns false when the block is missing or its
    /// row is not realized (virtualized out) — callers can then scroll proportionally and retry.
    /// </summary>
    public bool ScrollToBlock(string blockId)
    {
        var block = BlockHierarchy.FindById(Blocks, blockId);
        if (block == null)
            return false;

        var editable = GetEditableBlockForViewModel(block);
        if (editable == null)
            return false;

        editable.BringIntoView();
        return true;
    }
}
