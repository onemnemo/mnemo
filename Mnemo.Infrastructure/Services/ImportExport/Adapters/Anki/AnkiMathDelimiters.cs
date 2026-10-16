using System.Text;
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

    /// <summary>Rewrites every spelling an Anki field may carry into the dollar dialect.</summary>
    public static string ToCardText(string text)
    {
        if (string.IsNullOrEmpty(text))
            return text;

        // The bracket forms first: their bodies can contain the backslash forms' characters.
        var normalized = BracketDisplayMathRegex.Replace(text, "$$$$${body}$$$$");
        normalized = BracketInlineMathRegex.Replace(normalized, StoredInline(normalized));
        normalized = DisplayMathRegex.Replace(normalized, "$$$$${body}$$$$");
        normalized = InlineMathRegex.Replace(normalized, StoredInline(normalized));
        return normalized;
    }

    // Stored in the tight form the card reader takes as maths.
    private static MatchEvaluator StoredInline(string input) => match =>
    {
        var body = CardMath.ForStorage(match.Groups["body"].Value, input.AsSpan(match.Index + match.Length));
        return body.Length == 0 ? match.Value : "$" + body + "$";
    };

    /// <summary>
    /// Rewrites dollar maths back into the MathJax delimiters an Anki card renders.
    /// <see cref="CardMath"/> decides what counts as a formula, as the card renderer does.
    /// </summary>
    public static string ToAnkiField(string text, Func<string, string>? mapText = null)
    {
        if (string.IsNullOrEmpty(text))
            return text;

        var field = new StringBuilder(text.Length + 8);
        foreach (var piece in CardMath.Split(text))
        {
            field.Append(piece.Kind switch
            {
                CardMathKind.Inline => $@"\({piece.Value}\)",
                CardMathKind.Display => $@"\[{piece.Value}\]",
                _ => mapText is null ? piece.Value : mapText(piece.Value),
            });
        }

        return field.ToString();
    }
}
