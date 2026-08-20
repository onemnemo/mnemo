using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.UI.Components.BlockEditor;

public partial class BlockViewModel
{
    private string? _previousContent;
    private List<InlineSpan>? _previousSpans;

    public IReadOnlyList<InlineSpan> Spans => _spans;

    private void EnsureHeadingBold()
    {
        if (_type is not (BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4))
            return;
        var boldRuns = _spans
            .Select(s => s is TextSpan t ? t with { Style = t.Style.WithSet(InlineFormatKind.Bold) } : s)
            .ToList();
        _spans = InlineSpanFormatApplier.Normalize(boldRuns);
        if (_spans.Count == 0)
            _spans.Add(new TextSpan(string.Empty, new TextStyle(Bold: true)));
    }

    /// <summary>Removes bold from all runs when leaving a heading block (e.g. converting to plain text).</summary>
    private void StripHeadingBoldFromRuns()
    {
        _spans = InlineSpanFormatApplier.Normalize(
            _spans.Select(s => s is TextSpan t ? t with { Style = t.Style.WithClear(InlineFormatKind.Bold) } : s).ToList());
        if (_spans.Count == 0)
            _spans.Add(InlineSpan.Plain(string.Empty));
        _cachedFlatContent = InlineSpanFormatApplier.Flatten(_spans);
        OnPropertyChanged(nameof(Content));
        OnPropertyChanged(nameof(Spans));
        ContentChanged?.Invoke(this);
    }

    /// <summary>
    /// Replace the entire run list (e.g. for undo/redo or deserialization).
    /// Normalizes and refreshes Content. Does not raise ContentChanged.
    /// </summary>
    /// <remarks>
    /// Important: does not raise <c>ContentChanged</c>, so it bypasses history tracking entirely.
    /// Use only for undo/redo restore, initial load, and programmatic resets.
    /// For live user edits (typing, paste, inline delete) use <see cref="CommitSpansFromEditor"/> instead;
    /// that path records the pre-edit snapshot so TrackTypingEdit can build a TextEditOperation.
    /// Mixing the two causes silent undo gaps or duplicate undo steps.
    /// </remarks>
    public void SetSpans(IReadOnlyList<InlineSpan> runs)
    {
        _spans = InlineSpanFormatApplier.Normalize(runs);
        if (_spans.Count == 0)
            _spans.Add(InlineSpan.Plain(string.Empty));
        EnsureHeadingBold();

        // Detect URLs that exist as plain text (e.g. loaded from storage, pasted, or undo'd
        // from an older format). CommitSpansFromEditor does the same check on every keystroke;
        // SetSpans must do it too so links are detected on initial load and after undo/redo.
        if (_type != BlockType.Code)
        {
            var flat = InlineSpanFormatApplier.Flatten(_spans);
            if (MayContainAutoLink(flat))
            {
                var autolinked = InlineAutoLink.Apply(_spans);
                if (!SpansListContentEqual(_spans, autolinked))
                {
                    _spans = autolinked;
                    EnsureHeadingBold();
                }
            }
        }

        _cachedFlatContent = InlineSpanFormatApplier.Flatten(_spans);
        OnPropertyChanged(nameof(Content));
        OnPropertyChanged(nameof(Spans));
        OnPropertyChanged(nameof(Watermark));
    }

    /// <summary>
    /// Commit runs from the editor: capture previous content for history, update runs, then raise ContentChanged.
    /// Use this for user edits (typing, paste, delete selection); use SetSpans for restore/undo.
    /// Returns true if autolink/normalization mutated the spans further (caller may need to push VM â†’ editor).
    /// </summary>
    public bool CommitSpansFromEditor(IReadOnlyList<InlineSpan> newRuns)
    {
        _previousContent = _cachedFlatContent;
        _previousSpans = CloneSpans();
        SetSpans(newRuns);
        bool mutated = false;
        if (_type != BlockType.Code)
        {
            // Cheap pre-check: if the flat text contains no URL-like sequences, skip the expensive
            // autolink (regex walk + Normalize) entirely. This is the common case for every keystroke
            // outside of URL text and dominates per-keystroke cost for documents without links.
            if (MayContainAutoLink(_cachedFlatContent))
            {
                var autolinked = InlineAutoLink.Apply(_spans);
                // Apply already returns a Normalize'd list; skip the second Normalize from the old path.
                if (!SpansListContentEqual(_spans, autolinked))
                {
                    _spans = autolinked;
                    EnsureHeadingBold();
                    _cachedFlatContent = InlineSpanFormatApplier.Flatten(_spans);
                    OnPropertyChanged(nameof(Content));
                    OnPropertyChanged(nameof(Spans));
                    OnPropertyChanged(nameof(Watermark));
                    mutated = true;
                }
            }
        }

        ContentChanged?.Invoke(this);
        return mutated;
    }

    /// <summary>Fast-path test: does <paramref name="text"/> contain any character sequence that <see cref="InlineAutoLink"/> could match?</summary>
    private static bool MayContainAutoLink(string text)
    {
        if (string.IsNullOrEmpty(text) || text.Length < 4)
            return false;
        // Cheapest sniff for URL/protocol heads matching InlineAutoLink's regex.
        return text.IndexOf(':', StringComparison.Ordinal) >= 0
            || text.IndexOf("www.", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static bool SpansListContentEqual(IReadOnlyList<InlineSpan> a, IReadOnlyList<InlineSpan> b)
    {
        if (a.Count != b.Count) return false;
        for (int i = 0; i < a.Count; i++)
        {
            switch (a[i], b[i])
            {
                case (TextSpan ta, TextSpan tb):
                    if (ta.Text != tb.Text || ta.Style != tb.Style) return false;
                    break;
                case (EquationSpan ea, EquationSpan eb):
                    if (ea.Latex != eb.Latex || ea.Style != eb.Style) return false;
                    break;
                case (FractionSpan fa, FractionSpan fb):
                    if (fa.Numerator != fb.Numerator || fa.Denominator != fb.Denominator || fa.Style != fb.Style) return false;
                    break;
                default:
                    return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Apply a format toggle to the selection range.
    /// Returns the (unchanged) selection for the caller to restore on the TextBox.
    /// </summary>
    public (int Start, int End) ApplyFormat(int start, int end, InlineFormatKind kind, string? color = null)
    {
        if (kind == InlineFormatKind.Bold && _type is BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4)
            return (start, end);

        _previousContent = _cachedFlatContent;
        _previousSpans = CloneSpans();
        _spans = InlineSpanFormatApplier.Apply(_spans, start, end, kind, color);
        _cachedFlatContent = InlineSpanFormatApplier.Flatten(_spans);
        OnPropertyChanged(nameof(Content));
        OnPropertyChanged(nameof(Spans));
        ContentChanged?.Invoke(this);
        return (start, end);
    }

    /// <summary>
    /// Sets or clears a link on <c>[start, end)</c>, optionally replacing that range with <paramref name="displayText"/> first.
    /// When <paramref name="removeLink"/> is true, clears link formatting on the range (ignores <paramref name="url"/>).
    /// </summary>
    public (int Start, int End) ApplyLinkEdit(int start, int end, string displayText, string url, bool removeLink)
    {
        _previousContent = _cachedFlatContent;
        _previousSpans = CloneSpans();

        if (removeLink)
        {
            _spans = InlineSpanFormatApplier.Apply(_spans, start, end, InlineFormatKind.Link, null);
            _cachedFlatContent = InlineSpanFormatApplier.Flatten(_spans);
            OnPropertyChanged(nameof(Content));
            OnPropertyChanged(nameof(Spans));
            ContentChanged?.Invoke(this);
            return (start, end);
        }

        var flat = InlineSpanFormatApplier.Flatten(_spans);
        if (start < 0 || end > flat.Length || start > end)
            return (start, end);

        if (end > start)
        {
            var slice = flat.Substring(start, end - start);
            if (slice != displayText)
            {
                var newFlat = flat.Substring(0, start) + displayText + flat.Substring(end);
                _spans = InlineSpanFormatApplier.ApplyTextEdit(_spans, flat, newFlat);
            }
        }

        flat = InlineSpanFormatApplier.Flatten(_spans);
        int linkEnd = start + displayText.Length;
        if (linkEnd > flat.Length) linkEnd = flat.Length;
        if (linkEnd <= start)
        {
            OnPropertyChanged(nameof(Content));
            OnPropertyChanged(nameof(Spans));
            ContentChanged?.Invoke(this);
            return (start, start);
        }

        _spans = InlineSpanFormatApplier.Apply(_spans, start, linkEnd, InlineFormatKind.Link, url);
        _cachedFlatContent = InlineSpanFormatApplier.Flatten(_spans);
        OnPropertyChanged(nameof(Content));
        OnPropertyChanged(nameof(Spans));
        ContentChanged?.Invoke(this);
        return (start, linkEnd);
    }

    /// <summary>
    /// Deep-copy the current runs for snapshotting (undo/redo).
    /// </summary>
    public List<InlineSpan> CloneSpans() => new(_spans);
}
