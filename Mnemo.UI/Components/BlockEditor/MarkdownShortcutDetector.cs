using Mnemo.Core.Models;
using System;
using System.Collections.Generic;
using System.Globalization;

namespace Mnemo.UI.Components.BlockEditor;

public class MarkdownShortcutDetector
{
    /// <summary>Initial plain text after stripping a markdown line prefix; not stored in <see cref="BlockViewModel.Meta"/>.</summary>
    public const string ShortcutReplacementContentKey = "__shortcutContent";
    /// <summary>Initial ordered-list index parsed from a markdown prefix; not stored in <see cref="BlockViewModel.Meta"/>.</summary>
    public const string ShortcutListNumberIndexKey = "__shortcutListNumberIndex";

    private static readonly Dictionary<string, (BlockType Type, Dictionary<string, object>? Meta)> Shortcuts = new()
    {
        ["#"] = (BlockType.Heading1, null),
        ["##"] = (BlockType.Heading2, null),
        ["###"] = (BlockType.Heading3, null),
        ["####"] = (BlockType.Heading4, null),
        ["-"] = (BlockType.BulletList, null),
        ["*"] = (BlockType.BulletList, null),
        ["[]"] = (BlockType.Checklist, null),
        ["[ ]"] = (BlockType.Checklist, null),
        [">"] = (BlockType.Quote, null),
        ["---"] = (BlockType.Divider, null),
        ["```"] = (BlockType.Code, new Dictionary<string, object> { ["language"] = "csharp" }),
        ["1."] = (BlockType.NumberedList, null)
    };

    public event Action<BlockType, Dictionary<string, object>?>? ShortcutDetected;

    /// <param name="blockType">Current block; leading <c>* </c>/<c>- </c>/<c>+ </c> → list only applies to <see cref="BlockType.Text"/>.</param>
    public bool TryDetectShortcut(RichTextEditor editor, BlockType blockType)
    {
        if (editor == null) return false;
        var text = editor.Text;

        // CommonMark list markers at block start, remainder becomes list item body (e.g. "* " + existing text).
        if (blockType == BlockType.Text && TryMatchLeadingBulletMarker(text, out var afterMarker))
        {
            var meta = new Dictionary<string, object> { [ShortcutReplacementContentKey] = afterMarker };
            ShortcutDetected?.Invoke(BlockType.BulletList, meta);
            return true;
        }

        if (blockType == BlockType.Text && TryMatchLeadingNumberedMarker(text, out var listNumberIndex, out afterMarker))
        {
            var meta = new Dictionary<string, object>
            {
                [ShortcutReplacementContentKey] = afterMarker,
                [ShortcutListNumberIndexKey] = listNumberIndex
            };
            ShortcutDetected?.Invoke(BlockType.NumberedList, meta);
            return true;
        }

        var trimmed = text.Trim();
        if (IsDividerShortcut(trimmed))
        {
            ShortcutDetected?.Invoke(BlockType.Divider, null);
            return true;
        }

        if (Shortcuts.TryGetValue(trimmed, out var conversion))
        {
            ShortcutDetected?.Invoke(conversion.Type, conversion.Meta);
            return true;
        }
        return false;
    }

    private static bool TryMatchLeadingBulletMarker(string text, out string remainder)
    {
        remainder = string.Empty;
        if (text.Length < 2) return false;
        var c0 = text[0];
        if (c0 is not ('*' or '-' or '+')) return false;
        if (text[1] is not (' ' or '\t')) return false;
        remainder = text.Length > 2 ? text[2..] : string.Empty;
        return true;
    }

    private static bool TryMatchLeadingNumberedMarker(string text, out int listNumberIndex, out string remainder)
    {
        listNumberIndex = 1;
        remainder = string.Empty;

        var dotIndex = text.IndexOf('.');
        if (dotIndex <= 0 || dotIndex + 1 >= text.Length)
            return false;

        if (text[dotIndex + 1] is not (' ' or '\t'))
            return false;

        var numberText = text[..dotIndex];
        foreach (var c in numberText)
        {
            if (!char.IsDigit(c))
                return false;
        }

        if (!int.TryParse(numberText, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed < 1)
            return false;

        listNumberIndex = parsed;
        remainder = text.Length > dotIndex + 2 ? text[(dotIndex + 2)..] : string.Empty;
        return true;
    }

    public bool IsMarkdownShortcutKey(string text) =>
        !string.IsNullOrWhiteSpace(text)
        && (Shortcuts.ContainsKey(text.Trim()) || TryMatchLeadingNumberedMarker(text, out _, out _));

    private static bool IsDividerShortcut(string trimmed)
    {
        // When the text shortcut converts "-- " into an en dash and a space first, typing "--- " can
        // become a hyphen followed by an en dash, or an en dash followed by a hyphen.
        // Treat both forms as divider triggers so users still get a divider from three hyphens.
        return trimmed is "---" or "-–" or "–-";
    }
}
