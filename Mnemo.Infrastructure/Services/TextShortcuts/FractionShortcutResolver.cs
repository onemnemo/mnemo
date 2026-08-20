using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Mnemo.Infrastructure.Services.TextShortcuts;

/// <summary>
/// Resolves escaped ASCII fraction tokens to Unicode fractions.
/// The token must start with '\' (for example: <c>\3/7</c>).
/// </summary>
public static class FractionShortcutResolver
{
    // Fractions with dedicated Unicode glyphs, highest fidelity.
    private static readonly Dictionary<(int Numerator, int Denominator), char> UnicodeGlyphs = new()
    {
        { (1, 2), '\u00BD' }, // ½
        { (1, 3), '\u2153' }, // ⅓
        { (2, 3), '\u2154' }, // ⅔
        { (1, 4), '\u00BC' }, // ¼
        { (3, 4), '\u00BE' }, // ¾
        { (1, 8), '\u215B' }, // ⅛
        { (3, 8), '\u215C' }, // ⅜
        { (5, 8), '\u215D' }, // ⅝
        { (7, 8), '\u215E' }  // ⅞
    };

    private static readonly char[] Superscripts = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
    private static readonly char[] Subscripts = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

    // Required leading '\' then digits, slash, digits.
    private static readonly Regex FractionPattern = new(
        @"^\\(\d+)/(\d+)$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>
    /// Returns null when input is not a supported fraction pattern.
    /// </summary>
    public static string? TryResolve(string input)
    {
        if (!TryParse(input, out var numerator, out var denominator))
            return null;

        return Render(numerator, denominator);
    }

    public static bool TryParse(string input, out int numerator, out int denominator)
    {
        numerator = 0;
        denominator = 1;
        if (string.IsNullOrEmpty(input))
            return false;
        var match = FractionPattern.Match(input);
        if (!match.Success)
            return false;
        if (!int.TryParse(match.Groups[1].Value, out numerator)
            || !int.TryParse(match.Groups[2].Value, out denominator)
            || denominator == 0)
            return false;
        return true;
    }

    public static string Render(int numerator, int denominator)
    {
        if (UnicodeGlyphs.TryGetValue((numerator, denominator), out var glyph))
            return glyph.ToString();

        var superNum = ToDigitString(numerator, Superscripts);
        var subDen = ToDigitString(denominator, Subscripts);
        return $"{superNum}\u2044{subDen}";
    }

    private static string ToDigitString(int value, char[] digitMap)
    {
        var raw = value.ToString();
        var sb = new StringBuilder(raw.Length);
        foreach (var c in raw)
        {
            var idx = c - '0';
            if (idx < 0 || idx > 9)
                return string.Empty;
            sb.Append(digitMap[idx]);
        }
        return sb.ToString();
    }
}
