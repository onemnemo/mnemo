using System.Text;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// The vertical rhythm of an exported note, derived from the editor's type scale so a page
/// carries the same air as the note on screen.
/// </summary>
/// <remarks>
/// The two engines measure a line differently. CSS centres the glyphs in a line box as tall as
/// <c>line-height</c>, so the space between two lines of prose is hidden inside their boxes.
/// Typst measures a line from cap height to baseline and states the space between lines as
/// <c>leading</c>. The arithmetic here moves that hidden space across: what a CSS line box
/// carries above the cap height and below the baseline becomes leading between lines and
/// spacing between blocks, and a heading's margins gain the slack of the lines on either side
/// of it. Geist is the embedded face, so its metrics are constants rather than something read
/// off the font at export time.
/// </remarks>
internal static class NoteTypstRhythm
{
    // Geist's vertical metrics in em. The ascender and descender bound a CSS line's content
    // area; the cap height is where Typst puts the top edge of a line.
    private const double Ascender = 1.005;
    private const double Descender = 0.295;
    private const double CapHeight = 0.71;

    // The editor's prose: a 1.65 line height and a 6px gap between blocks on a 16px body.
    private const double BodyLineHeight = 1.65;
    private const double BlockGap = 6.0 / 16.0;

    // The editor's quote and callout both stand 10px off their neighbours. A quote pads its
    // text 2px above and below with 16px before it; a callout pads 12px and 16px.
    private const double AsideMargin = 10.0 / 16.0;
    private const double QuotePaddingY = 2.0 / 16.0;
    private const double QuotePaddingLeft = 16.0 / 16.0;
    private const double CalloutPaddingY = 12.0 / 16.0;
    private const double CalloutPaddingX = 16.0 / 16.0;

    /// <summary>One level of the editor's heading scale, in em of the body text.</summary>
    private sealed record HeadingScale(
        int Level,
        double Size,
        double LineHeight,
        int Weight,
        double Tracking,
        double MarginTop,
        double MarginBottom);

    // The editor's h1 to h4: size, line height, weight, letter spacing, and the margins in
    // px over the 16px body. The margin above is what separates a heading from the text
    // before it; the one below is small, so a heading belongs to the text it introduces.
    private static readonly HeadingScale[] Headings =
    [
        new(1, 1.75, 1.25, 700, -0.02, 32.0 / 16.0, 4.0 / 16.0),
        new(2, 1.375, 1.3, 600, -0.015, 28.0 / 16.0, 2.0 / 16.0),
        new(3, 1.125, 1.35, 600, -0.01, 20.0 / 16.0, 2.0 / 16.0),
        new(4, 1.0, 1.4, 600, 0, 16.0 / 16.0, 2.0 / 16.0)
    ];

    /// <summary>
    /// The paragraph and block settings and the heading show rules, one line each. A paragraph,
    /// a list item, an equation and a quote are each a block to the reader, so blocks and
    /// paragraphs share one spacing; a gap that changed with the block kind would read as a
    /// mistake. Headings are real Typst headings styled here, at absolute sizes because a show
    /// rule's em is the heading's own.
    /// </summary>
    public static void AppendPreamble(StringBuilder sb, float baseFontSizePt)
    {
        var spacing = NoteTypstDocumentComposer.Pt(BlockSpacing * baseFontSizePt);
        sb.Append("#set par(leading: ").Append(Em(BodyLeading)).Append(", spacing: ").Append(spacing).Append(")\n");
        sb.Append("#set block(spacing: ").Append(spacing).Append(")\n");

        // The editor draws a bold run inside a heading at the heading's own weight.
        sb.Append("#show heading: set strong(delta: 0)\n");

        foreach (var heading in Headings)
        {
            var selector = $"#show heading.where(level: {heading.Level}): ";

            sb.Append(selector).Append("set text(size: ").Append(NoteTypstDocumentComposer.Pt(heading.Size * baseFontSizePt))
              .Append(", weight: ").Append(heading.Weight);
            if (heading.Tracking != 0)
                sb.Append(", tracking: ").Append(Em(heading.Tracking));
            sb.Append(")\n");

            sb.Append(selector).Append("set par(leading: ").Append(Em(heading.LineHeight - CapHeight)).Append(")\n");

            sb.Append(selector).Append("set block(above: ").Append(NoteTypstDocumentComposer.Pt(SpaceAbove(heading) * baseFontSizePt))
              .Append(", below: ").Append(NoteTypstDocumentComposer.Pt(SpaceBelow(heading) * baseFontSizePt)).Append(")\n");
        }
    }

    /// <summary>
    /// The block arguments that give a quote the editor's room: its margin against the lines
    /// either side, and its padding, which holds the slack of the line box inside it so the rule
    /// on the left spans what the border spans on screen.
    /// </summary>
    public static string QuoteArguments(float baseFontSizePt) =>
        AsideArguments(baseFontSizePt, QuotePaddingY, "left: " + Pt(QuotePaddingLeft * baseFontSizePt));

    /// <summary>The same for a callout, whose tint is padded on every side.</summary>
    public static string CalloutArguments(float baseFontSizePt) =>
        AsideArguments(baseFontSizePt, CalloutPaddingY, "x: " + Pt(CalloutPaddingX * baseFontSizePt));

    private static string AsideArguments(float baseFontSizePt, double paddingY, string horizontalInset)
    {
        var above = Pt((SlackBelow(BodyLineHeight) + AsideMargin) * baseFontSizePt);
        var below = Pt((AsideMargin + SlackAbove(BodyLineHeight)) * baseFontSizePt);
        var top = Pt((paddingY + SlackAbove(BodyLineHeight)) * baseFontSizePt);
        var bottom = Pt((paddingY + SlackBelow(BodyLineHeight)) * baseFontSizePt);
        return $"above: {above}, below: {below}, inset: (top: {top}, bottom: {bottom}, {horizontalInset})";
    }

    /// <summary>Between two lines of body text, from one baseline to the next cap height.</summary>
    internal static double BodyLeading => BodyLineHeight - CapHeight;

    /// <summary>Between two blocks of body text: the slack under one line, the gap, the slack over the next.</summary>
    internal static double BlockSpacing => SlackBelow(BodyLineHeight) + BlockGap + SlackAbove(BodyLineHeight);

    // From the baseline of the text before the heading to the heading's cap height, and from the
    // heading's baseline to the cap height of the text after it, in em of the body.
    private static double SpaceAbove(HeadingScale h) => SlackBelow(BodyLineHeight) + h.MarginTop + h.Size * SlackAbove(h.LineHeight);
    private static double SpaceBelow(HeadingScale h) => h.Size * SlackBelow(h.LineHeight) + h.MarginBottom + SlackAbove(BodyLineHeight);

    // How far a CSS line box reaches above its cap height and below its baseline, in em of its
    // own text: half of what the line height adds to the content area, on each side.
    private static double SlackAbove(double lineHeight) => (lineHeight + Ascender - Descender) / 2 - CapHeight;
    private static double SlackBelow(double lineHeight) => (lineHeight + Descender - Ascender) / 2;

    private static string Em(double value) => NoteTypstDocumentComposer.Num(value) + "em";

    private static string Pt(double value) => NoteTypstDocumentComposer.Pt(value);
}
