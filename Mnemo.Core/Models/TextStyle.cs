namespace Mnemo.Core.Models;

/// <summary>Text-only annotations (no inline equation, use <see cref="EquationSpan"/>).</summary>
public readonly record struct TextStyle(
    bool Bold = false,
    bool Italic = false,
    bool Underline = false,
    bool Strikethrough = false,
    bool Code = false,
    bool Highlight = false,
    string? BackgroundColor = null,
    string? ForegroundColor = null,
    string? LinkUrl = null,
    bool SuppressAutoLink = false,
    bool Subscript = false,
    bool Superscript = false)
{
    public static readonly TextStyle Default = new();

    public TextStyle WithToggle(Formatting.InlineFormatKind kind, string? color = null) => kind switch
    {
        Formatting.InlineFormatKind.Bold => this with { Bold = !Bold },
        Formatting.InlineFormatKind.Italic => this with { Italic = !Italic },
        Formatting.InlineFormatKind.Underline => this with { Underline = !Underline },
        Formatting.InlineFormatKind.Strikethrough => this with { Strikethrough = !Strikethrough },
        Formatting.InlineFormatKind.Code => this with { Code = !Code },
        Formatting.InlineFormatKind.Highlight => this with { Highlight = !Highlight },
        Formatting.InlineFormatKind.BackgroundColor => this with { BackgroundColor = BackgroundColor == color ? null : color },
        Formatting.InlineFormatKind.ForegroundColor => this with { ForegroundColor = ForegroundColor == color ? null : color },
        Formatting.InlineFormatKind.Link => LinkUrl != null
            ? this with { LinkUrl = null, SuppressAutoLink = true }
            : this,
        Formatting.InlineFormatKind.Subscript => this with { Subscript = !Subscript, Superscript = Subscript ? Superscript : false },
        Formatting.InlineFormatKind.Superscript => this with { Superscript = !Superscript, Subscript = Superscript ? Subscript : false },
        Formatting.InlineFormatKind.Equation => this,
        _ => this
    };

    public TextStyle WithSet(Formatting.InlineFormatKind kind, string? color = null) => kind switch
    {
        Formatting.InlineFormatKind.Bold => this with { Bold = true },
        Formatting.InlineFormatKind.Italic => this with { Italic = true },
        Formatting.InlineFormatKind.Underline => this with { Underline = true },
        Formatting.InlineFormatKind.Strikethrough => this with { Strikethrough = true },
        Formatting.InlineFormatKind.Code => this with { Code = true },
        Formatting.InlineFormatKind.Highlight => this with { Highlight = true },
        Formatting.InlineFormatKind.BackgroundColor => this with { BackgroundColor = color },
        Formatting.InlineFormatKind.ForegroundColor => this with { ForegroundColor = color },
        Formatting.InlineFormatKind.Link => this with { LinkUrl = color, SuppressAutoLink = false },
        Formatting.InlineFormatKind.Subscript => this with { Subscript = true, Superscript = false },
        Formatting.InlineFormatKind.Superscript => this with { Superscript = true, Subscript = false },
        Formatting.InlineFormatKind.Equation => this,
        _ => this
    };

    public TextStyle WithClear(Formatting.InlineFormatKind kind) => kind switch
    {
        Formatting.InlineFormatKind.Bold => this with { Bold = false },
        Formatting.InlineFormatKind.Italic => this with { Italic = false },
        Formatting.InlineFormatKind.Underline => this with { Underline = false },
        Formatting.InlineFormatKind.Strikethrough => this with { Strikethrough = false },
        Formatting.InlineFormatKind.Code => this with { Code = false },
        Formatting.InlineFormatKind.Highlight => this with { Highlight = false },
        Formatting.InlineFormatKind.BackgroundColor => this with { BackgroundColor = null },
        Formatting.InlineFormatKind.ForegroundColor => this with { ForegroundColor = null },
        Formatting.InlineFormatKind.Link => LinkUrl != null
            ? this with { LinkUrl = null, SuppressAutoLink = true }
            : this,
        Formatting.InlineFormatKind.Subscript => this with { Subscript = false },
        Formatting.InlineFormatKind.Superscript => this with { Superscript = false },
        Formatting.InlineFormatKind.Equation => this,
        _ => this
    };

    public bool Has(Formatting.InlineFormatKind kind) => kind switch
    {
        Formatting.InlineFormatKind.Bold => Bold,
        Formatting.InlineFormatKind.Italic => Italic,
        Formatting.InlineFormatKind.Underline => Underline,
        Formatting.InlineFormatKind.Strikethrough => Strikethrough,
        Formatting.InlineFormatKind.Code => Code,
        Formatting.InlineFormatKind.Highlight => Highlight,
        Formatting.InlineFormatKind.BackgroundColor => BackgroundColor != null,
        Formatting.InlineFormatKind.ForegroundColor => ForegroundColor != null,
        Formatting.InlineFormatKind.Link => LinkUrl != null,
        Formatting.InlineFormatKind.Subscript => Subscript,
        Formatting.InlineFormatKind.Superscript => Superscript,
        Formatting.InlineFormatKind.Equation => false,
        _ => false
    };
}
