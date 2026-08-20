namespace Mnemo.UI.Components.BlockEditor;

/// <summary>
/// Single place for "empty paragraph" and legacy invisible-char handling. Empty blocks use
/// virtual selection in <see cref="RichTextEditor"/>; no sentinel is stored in new content.
/// </summary>
internal static class BlockEditorContentPolicy
{
    /// <summary>Earlier builds used U+200B in empty paragraphs; strip for comparisons and export.</summary>
    public const char LegacyParagraphSentinel = '\u200B';

    public static string WithoutLegacySentinel(string? s)
    {
        if (string.IsNullOrEmpty(s)) return string.Empty;
        return s.Replace(LegacyParagraphSentinel.ToString(), string.Empty);
    }

    public static bool IsVisuallyEmpty(string? s) =>
        string.IsNullOrWhiteSpace(WithoutLegacySentinel(s));

    public static string MergeSuffixFromFollowingBlock(string? followingContent)
    {
        if (IsVisuallyEmpty(followingContent)) return string.Empty;
        return (followingContent ?? string.Empty).TrimStart(LegacyParagraphSentinel);
    }
}
