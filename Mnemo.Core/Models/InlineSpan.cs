using System.Text.Json.Serialization;

namespace Mnemo.Core.Models;

/// <summary>One segment of inline content in a rich text block.</summary>
[JsonConverter(typeof(Serialization.InlineSpanJsonConverter))]
public abstract record InlineSpan
{
    /// <summary>Logical character used only in transient flat strings for caret/diff (never stored in <see cref="TextSpan.Text"/>).</summary>
    public const char EquationAtomChar = '\uFFFC';
    /// <summary>Logical character used only in transient flat strings for inline fractions.</summary>
    public const char FractionAtomChar = '\uFFF9';

    public static TextSpan Plain(string text) => new(text, TextStyle.Default);
}

/// <summary>Plain rich text.</summary>
public sealed record TextSpan(string Text, TextStyle Style = default) : InlineSpan;

/// <summary>Inline LaTeX; atomic for caret and selection (no phantom characters in <see cref="TextSpan"/>).</summary>
public sealed record EquationSpan(string Latex, TextStyle Style = default) : InlineSpan;

/// <summary>Inline fraction atom; atomic for caret and selection.</summary>
public sealed record FractionSpan(int Numerator, int Denominator, TextStyle Style = default) : InlineSpan;
