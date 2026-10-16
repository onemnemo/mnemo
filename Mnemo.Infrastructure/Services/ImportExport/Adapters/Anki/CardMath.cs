using System.Text;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

internal enum CardMathKind
{
    Text,
    Inline,
    Display,
}

internal readonly record struct CardMathPiece(CardMathKind Kind, string Value);

/// <summary>
/// Splits card text into literal runs and maths the way the web renderer does. It shares the
/// vectors in <c>math-split.json</c> with <c>splitMath</c> in <c>math.ts</c>.
/// </summary>
internal static class CardMath
{
    public static IReadOnlyList<CardMathPiece> Split(string source)
    {
        var pieces = new List<CardMathPiece>();
        var text = new StringBuilder();

        void Flush()
        {
            if (text.Length > 0)
                pieces.Add(new CardMathPiece(CardMathKind.Text, text.ToString()));
            text.Clear();
        }

        var i = 0;
        while (i < source.Length)
        {
            var c = source[i];
            if (c == '\\' && i + 1 < source.Length)
            {
                if (source[i + 1] == '$')
                    text.Append('$');
                else
                    text.Append(c).Append(source[i + 1]);
                i += 2;
                continue;
            }

            if (c == '$')
            {
                var display = i + 1 < source.Length && source[i + 1] == '$' ? DisplayEnd(source, i) : -1;
                var end = display == -1 ? InlineEnd(source, i) : display;
                if (end != -1)
                {
                    Flush();
                    var fence = display == -1 ? 1 : 2;
                    var kind = display == -1 ? CardMathKind.Inline : CardMathKind.Display;
                    pieces.Add(new CardMathPiece(kind, source.Substring(i + fence, end - i - 2 * fence)));
                    i = end;
                    continue;
                }
            }

            text.Append(c);
            i++;
        }

        Flush();
        return pieces;
    }

    private const string Space = " \t\u00a0\u202f\u2009";

    /// <summary>Space, tab, and the no-break and thin spaces some languages put before a currency sign.</summary>
    private static bool IsSpace(char c) => Space.Contains(c);

    /// <summary>
    /// The stored body of an imported inline formula. Spaces inside the dollars are trimmed. A bare
    /// number followed by a digit gets an empty group, which renders the same and reads as maths.
    /// </summary>
    public static string ForStorage(string body, ReadOnlySpan<char> following)
    {
        var tight = body.AsSpan().Trim(Space).ToString();
        var needsGroup = tight.Length > 0 && IsDigit(tight[0]) && following.Length > 0 && IsDigit(following[0])
            && tight.AsSpan().IndexOfAny(@"\^{}") < 0;
        return needsGroup ? tight + "{}" : tight;
    }

    private static bool IsDigit(char c) => c is >= '0' and <= '9';

    private static bool IsDigitAt(string source, int index) => index >= 0 && index < source.Length && IsDigit(source[index]);

    private static int DisplayEnd(string source, int at)
    {
        for (var i = at + 3; i < source.Length - 1; i++)
        {
            if (source[i] == '\\')
                i++;
            else if (source[i] == '$' && source[i + 1] == '$')
                return i + 2;
        }

        return -1;
    }

    /// <summary>
    /// End of a <c>$…$</c> formula opening at <paramref name="at"/>, or -1. The pair closes at the next
    /// unescaped dollar on the line. A body with TeX is maths. A tight body is maths unless it starts
    /// with a digit and a digit follows. A body opening with a space is maths unless a digit comes
    /// before. A body of only spaces, or one that only ends in a space, is not maths.
    /// </summary>
    private static int InlineEnd(string source, int at)
    {
        var close = -1;
        for (var i = at + 1; i < source.Length; i++)
        {
            var c = source[i];
            if (c == '\n')
                return -1;
            if (c == '\\' && i + 1 < source.Length && source[i + 1] != '\n')
                i++;
            else if (c == '$')
            {
                close = i;
                break;
            }
        }

        if (close == -1)
            return -1;

        var body = source.AsSpan(at + 1, close - at - 1);
        if (body.Trim(Space).IsEmpty)
            return -1;
        if (body.IndexOfAny(@"\^{}") >= 0)
            return close + 1;
        if (IsSpace(body[0]))
        {
            var before = at - 1;
            while (before >= 0 && IsSpace(source[before]))
                before--;
            return IsDigitAt(source, before) ? -1 : close + 1;
        }

        if (IsSpace(body[^1]))
            return -1;
        return IsDigit(body[0]) && IsDigitAt(source, close + 1) ? -1 : close + 1;
    }
}
