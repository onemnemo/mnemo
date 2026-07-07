using System.Text.RegularExpressions;

namespace Mnemo.UI.Modules.Flashcards;

/// <summary>
/// Renders cloze markdown (<c>{{cN::answer}}</c>) for the study shell: the front <see cref="Mask"/>s each
/// deletion to <c>[…]</c>, the answer <see cref="Reveal"/>s the deletion content emphasized (bold). Both
/// operate on the canonical front text, leaving surrounding markdown (bold/italic) untouched so the
/// <c>MarkdownView</c> renders it normally.
/// </summary>
internal static class FlashcardClozeText
{
    private static readonly Regex ClozePattern =
        new(@"\{\{c\d+::(.*?)}}", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.Singleline);

    /// <summary>Front side: replaces every <c>{{cN::text}}</c> with a masked <c>[…]</c> placeholder.</summary>
    public static string Mask(string? front) =>
        string.IsNullOrEmpty(front) ? string.Empty : ClozePattern.Replace(front, "[…]");

    /// <summary>Answer side: replaces every <c>{{cN::text}}</c> with the deletion content, emphasized (bold).</summary>
    public static string Reveal(string? front) =>
        string.IsNullOrEmpty(front) ? string.Empty : ClozePattern.Replace(front, "**$1**");
}
