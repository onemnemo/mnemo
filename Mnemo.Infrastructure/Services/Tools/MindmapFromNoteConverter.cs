using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Tools.Mindmap;
using Mnemo.Infrastructure.Services.Notes;

namespace Mnemo.Infrastructure.Services.Tools;

/// <summary>Converts a note's heading/bullet structure into a nested mindmap outline.</summary>
internal static class MindmapFromNoteConverter
{
    public static List<MindmapOutlineNode> FromNote(Note note)
    {
        NoteDocumentHelper.EnsureBlocks(note);
        var blocks = note.Blocks ?? [];
        var roots = new List<MindmapOutlineNode>();
        var stack = new Stack<(int level, MindmapOutlineNode node)>();

        foreach (var block in blocks.OrderBy(b => b.Order))
        {
            block.EnsureSpans();
            var text = (block.Content ?? string.Empty).Trim();
            if (text.Length == 0 && block.Type != BlockType.Divider)
                continue;

            switch (block.Type)
            {
                case BlockType.Heading1:
                    PushHeading(roots, stack, 1, text);
                    break;
                case BlockType.Heading2:
                    PushHeading(roots, stack, 2, text);
                    break;
                case BlockType.Heading3:
                    PushHeading(roots, stack, 3, text);
                    break;
                case BlockType.Heading4:
                    PushHeading(roots, stack, 4, text);
                    break;
                case BlockType.BulletList:
                case BlockType.NumberedList:
                case BlockType.Checklist:
                    AttachLeaf(stack, text);
                    break;
                case BlockType.Text:
                    if (stack.Count == 0)
                        roots.Add(new MindmapOutlineNode { Label = text });
                    else
                        AttachLeaf(stack, text);
                    break;
            }
        }

        return roots;
    }

    private static void PushHeading(
        List<MindmapOutlineNode> roots,
        Stack<(int level, MindmapOutlineNode node)> stack,
        int level,
        string text)
    {
        var node = new MindmapOutlineNode { Label = text };

        while (stack.Count > 0 && stack.Peek().level >= level)
            stack.Pop();

        if (stack.Count == 0)
        {
            roots.Add(node);
        }
        else
        {
            stack.Peek().node.Children ??= [];
            stack.Peek().node.Children!.Add(node);
        }

        stack.Push((level, node));
    }

    private static void AttachLeaf(Stack<(int level, MindmapOutlineNode node)> stack, string text)
    {
        if (stack.Count == 0)
            return;

        var parent = stack.Peek().node;
        parent.Children ??= [];
        parent.Children.Add(new MindmapOutlineNode { Label = text });
    }
}
