using System.Text.RegularExpressions;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

/// <summary>
/// Translates between the several ways an Anki field spells maths and the single dialect a card
/// here is written and rendered in.
/// </summary>
/// <remarks>
/// Cards here hold maths between dollars, and only dollars. A field arriving in any other spelling
/// is drawn as its own source text, so the card shows backslashes and braces where it should show
/// the equation, which is why an import rewrites every form it knows into dollars.
///
/// Leaving a package in the same dialect is the mirror image of the same defect. Stock Anki renders
/// MathJax delimiters and does not treat a bare dollar as anything, so a card exported with the
/// dollars left in it stops being maths the moment it lands, and a round trip through another app
/// quietly costs every formula in the collection.
/// </remarks>
internal static class AnkiMathDelimiters
{
    // Both delimiter pairs must be present for a rewrite. A lone backslash-paren in ordinary prose
    // is text, and turning it into an opening dollar would put the rest of the card inside a
    // formula. Inline maths may not span a line the way a displayed block may.
    private static readonly Regex InlineMathRegex = new(@"\\\((?<body>[^\n]+?)\\\)", RegexOptions.Compiled);
    private static readonly Regex DisplayMathRegex = new(@"\\\[(?<body>.+?)\\\]", RegexOptions.Compiled | RegexOptions.Singleline);

    // Anki's own field syntax for the same two things.
    private static readonly Regex BracketInlineMathRegex = new(@"\[\$\](?<body>.+?)\[/\$\]", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex BracketDisplayMathRegex = new(@"\[\$\$\](?<body>.+?)\[/\$\$\]", RegexOptions.Compiled | RegexOptions.Singleline);

    // The renderer's own rule, character for character: a displayed block is anything between two
    // pairs of dollars and may span lines, an inline formula is anything between two single dollars
    // that holds neither a dollar nor a newline. Deliberately the same rule rather than a stricter
    // one, so what the other app draws is exactly what was being drawn here, including the cases
    // where a stray dollar in prose was already being read as maths.
    private static readonly Regex DollarDisplayRegex = new(@"\$\$(?<body>.+?)\$\$", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex DollarInlineRegex = new(@"\$(?<body>[^$\n]+?)\$", RegexOptions.Compiled);

    /// <summary>Rewrites every spelling an Anki field may carry into the dollar dialect.</summary>
    public static string ToCardText(string text)
    {
        if (string.IsNullOrEmpty(text))
            return text;

        // The bracket forms first: their bodies can contain the backslash forms' characters.
        var normalized = BracketDisplayMathRegex.Replace(text, "$$$$${body}$$$$");
        normalized = BracketInlineMathRegex.Replace(normalized, "$$${body}$$");
        normalized = DisplayMathRegex.Replace(normalized, "$$$$${body}$$$$");
        normalized = InlineMathRegex.Replace(normalized, "$$${body}$$");
        return normalized;
    }

    /// <summary>
    /// Rewrites the dollar dialect back into the MathJax delimiters an Anki card renders.
    /// </summary>
    /// <remarks>
    /// Displayed blocks go first. Run the other way round, the inline rule would take the first two
    /// dollars of a displayed block and leave the closing pair stranded.
    /// </remarks>
    public static string ToAnkiField(string text)
    {
        if (string.IsNullOrEmpty(text))
            return text;

        var converted = DollarDisplayRegex.Replace(text, @"\[${body}\]");
        return DollarInlineRegex.Replace(converted, @"\(${body}\)");
    }
}
