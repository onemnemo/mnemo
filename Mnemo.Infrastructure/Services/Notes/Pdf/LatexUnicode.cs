using System.Text;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// Turns the Unicode a note's equations carry into the LaTeX mitex typesets well.
///
/// Imported and pasted equations arrive as prose maths, "Zn²⁺" and "10⁻¹⁷" rather than
/// <c>Zn^{2+}</c> and <c>10^{-17}</c>. KaTeX draws those characters as they are, so the
/// editor looks right, while mitex reads each superscript digit as its own symbol and spaces
/// them apart. A run of superscript or subscript characters therefore becomes one grouped
/// script here, and the operator glyphs that have a LaTeX name get it.
/// </summary>
internal static class LatexUnicode
{
    private const string SuperscriptChars = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ";
    private const string SuperscriptPlain = "0123456789+-=()ni";
    private const string SubscriptChars = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ";
    private const string SubscriptPlain = "0123456789+-=()aeoxhklmnpst";

    private static readonly (char Glyph, string Latex)[] Symbols =
    [
        ('·', "\\cdot"),
        ('×', "\\times"),
        ('÷', "\\div"),
        ('⇌', "\\rightleftharpoons"),
        ('→', "\\rightarrow"),
        ('←', "\\leftarrow"),
        ('↔', "\\leftrightarrow"),
        ('⇒', "\\Rightarrow"),
        ('⇐', "\\Leftarrow"),
        ('⇔', "\\Leftrightarrow"),
        ('≤', "\\leq"),
        ('≥', "\\geq"),
        ('≠', "\\neq"),
        ('≈', "\\approx"),
        ('±', "\\pm"),
        ('∞', "\\infty"),
        ('°', "^{\\circ}"),
    ];

    public static string Normalize(string latex)
    {
        if (string.IsNullOrEmpty(latex))
            return latex;

        var sb = new StringBuilder(latex.Length + 16);
        var i = 0;
        while (i < latex.Length)
        {
            var ch = latex[i];
            var superIndex = SuperscriptChars.IndexOf(ch);
            if (superIndex >= 0)
            {
                i = AppendScript(sb, latex, i, SuperscriptChars, SuperscriptPlain, '^');
                continue;
            }

            var subIndex = SubscriptChars.IndexOf(ch);
            if (subIndex >= 0)
            {
                i = AppendScript(sb, latex, i, SubscriptChars, SubscriptPlain, '_');
                continue;
            }

            var replaced = false;
            foreach (var (glyph, replacement) in Symbols)
            {
                if (glyph != ch)
                    continue;
                sb.Append(replacement);
                // A command name runs on into a letter that follows it, so the two are
                // kept apart; anything else already ends the name.
                if (char.IsLetter(replacement[^1]) && i + 1 < latex.Length && char.IsLetter(latex[i + 1]))
                    sb.Append(' ');
                replaced = true;
                break;
            }

            if (!replaced)
                sb.Append(ch);
            i++;
        }

        return sb.ToString();
    }

    /// <summary>
    /// Appends the run of script characters starting at <paramref name="start"/> as one
    /// grouped script and returns the index after the run.
    /// </summary>
    private static int AppendScript(StringBuilder sb, string latex, int start, string chars, string plain, char marker)
    {
        sb.Append(marker).Append('{');
        var i = start;
        while (i < latex.Length)
        {
            var index = chars.IndexOf(latex[i]);
            if (index < 0)
                break;
            sb.Append(plain[index]);
            i++;
        }
        sb.Append('}');
        return i;
    }
}
