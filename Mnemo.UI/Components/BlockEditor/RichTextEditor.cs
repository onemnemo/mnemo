using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Media.TextFormatting;
using Avalonia.Utilities;
using Avalonia.Threading;
using Avalonia.Layout;
using Avalonia.Rendering;
using Avalonia.VisualTree;
using Avalonia.Controls.Primitives.PopupPositioning;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.LaTeX;
using Mnemo.Infrastructure.Services.TextShortcuts;
using Mnemo.UI.Controls;
using Mnemo.UI;
using Mnemo.UI.Services;
using Mnemo.UI.Services.LaTeX.Layout.Boxes;
using Mnemo.UI.Services.LaTeX.Rendering;

namespace Mnemo.UI.Components.BlockEditor;

/// <summary>
/// Custom editable control that renders styled <see cref="InlineSpan"/> lists directly via
/// <see cref="TextLayout"/>, giving pixel-accurate caret and selection geometry that stays
/// aligned with the visible rich text at all times.
/// </summary>
public partial class RichTextEditor : Control, ICustomHitTest, IRichTextEditorHost
{
    public readonly record struct SearchHighlightRange(int Start, int Length);

    // ── Avalonia properties ──────────────────────────────────────────────────

    public static readonly StyledProperty<IReadOnlyList<InlineSpan>> SpansProperty =
        AvaloniaProperty.Register<RichTextEditor, IReadOnlyList<InlineSpan>>(
            nameof(Spans), defaultValue: Array.Empty<InlineSpan>());

    public static readonly StyledProperty<string?> WatermarkProperty =
        AvaloniaProperty.Register<RichTextEditor, string?>(nameof(Watermark));

    /// <summary>
    /// When true, empty text + non-null <see cref="Watermark"/> is drawn without requiring pointer-over or focus on this control
    /// (e.g. image captions: parent sets Watermark while the pointer is over the image).
    /// </summary>
    public static readonly StyledProperty<bool> ShowInactiveWatermarkProperty =
        AvaloniaProperty.Register<RichTextEditor, bool>(nameof(ShowInactiveWatermark), defaultValue: false);

    public static readonly StyledProperty<double> FontSizeProperty =
        AvaloniaProperty.Register<RichTextEditor, double>(nameof(FontSize), defaultValue: 16.0);

    public static readonly StyledProperty<FontWeight> FontWeightProperty =
        AvaloniaProperty.Register<RichTextEditor, FontWeight>(nameof(FontWeight), defaultValue: FontWeight.Normal);

    public static readonly StyledProperty<IBrush?> ForegroundProperty =
        AvaloniaProperty.Register<RichTextEditor, IBrush?>(nameof(Foreground));

    public static readonly StyledProperty<IBrush?> CaretBrushProperty =
        AvaloniaProperty.Register<RichTextEditor, IBrush?>(nameof(CaretBrush));

    public static readonly StyledProperty<IBrush?> SelectionBrushProperty =
        AvaloniaProperty.Register<RichTextEditor, IBrush?>(nameof(SelectionBrush));

    public static readonly StyledProperty<bool> IsReadOnlyProperty =
        AvaloniaProperty.Register<RichTextEditor, bool>(nameof(IsReadOnly), defaultValue: false);

    /// <summary>
    /// When false, spell-check highlighting and background checks are disabled (preview/read-only surfaces).
    /// User preference <see cref="_spellcheckEnabled"/> still applies when this is true and <see cref="IsReadOnly"/> is false.
    /// </summary>
    public static readonly StyledProperty<bool> IsSpellcheckDecorationsEnabledProperty =
        AvaloniaProperty.Register<RichTextEditor, bool>(
            nameof(IsSpellcheckDecorationsEnabled), defaultValue: true);

    /// <summary>
    /// When true, inline equations show their raw LaTeX source while hovered.
    /// </summary>
    public static readonly StyledProperty<bool> ShowInlineEquationSourceOnHoverProperty =
        AvaloniaProperty.Register<RichTextEditor, bool>(nameof(ShowInlineEquationSourceOnHover), defaultValue: false);

    public static readonly StyledProperty<IReadOnlyList<SearchHighlightRange>> SearchHighlightRangesProperty =
        AvaloniaProperty.Register<RichTextEditor, IReadOnlyList<SearchHighlightRange>>(
            nameof(SearchHighlightRanges), defaultValue: Array.Empty<SearchHighlightRange>());

    public static readonly StyledProperty<SearchHighlightRange?> ActiveSearchHighlightRangeProperty =
        AvaloniaProperty.Register<RichTextEditor, SearchHighlightRange?>(nameof(ActiveSearchHighlightRange));

    public static readonly DirectProperty<RichTextEditor, int> CaretIndexProperty =
        AvaloniaProperty.RegisterDirect<RichTextEditor, int>(
            nameof(CaretIndex), o => o.CaretIndex, (o, v) => o.CaretIndex = v);

    public static readonly DirectProperty<RichTextEditor, int> SelectionStartProperty =
        AvaloniaProperty.RegisterDirect<RichTextEditor, int>(
            nameof(SelectionStart), o => o.SelectionStart, (o, v) => o.SelectionStart = v);

    public static readonly DirectProperty<RichTextEditor, int> SelectionEndProperty =
        AvaloniaProperty.RegisterDirect<RichTextEditor, int>(
            nameof(SelectionEnd), o => o.SelectionEnd, (o, v) => o.SelectionEnd = v);

    // ── Backing fields ───────────────────────────────────────────────────────

    private int _caretIndex;
    private int _selectionStart;
    private int _selectionEnd;
    private TextLayout? _textLayout;
    private TextLayout? _backgroundLayout;
    private TextLayout? _watermarkLayout;
    /// <summary>Text we built the current _textLayout for; used to detect stale layout when Spans were set after first paint.</summary>
    private string? _lastBuiltText;
    /// <summary>Logical caret boundary <c>k</c> → layout character index (same convention as <see cref="TextLayout"/>).</summary>
    internal int[]? _layoutBoundaryAtLogical;
    /// <summary>Length of the expanded layout string (spaces reserve inline math width).</summary>
    private int _layoutTextLength;
    /// <summary>Width we last built layout for; used in Render to avoid building with Bounds (can be 0 or stale) and to prevent layout loops.</summary>
    private double _lastLayoutWidth;
    private bool _caretVisible = true;
    private DispatcherTimer? _caretTimer;
    private bool _isDragging;
    private int _dragAnchor;
    private AutoShortcutUndoState? _pendingAutoShortcutUndo;

    /// <summary>
    /// When set, the sub/sup flags of this style are forced onto every newly inserted character run,
    /// overriding style inheritance from adjacent spans. Used for sticky sub/sup typing mode.
    /// Set <c>null</c> to resume natural style inheritance.
    /// Set <c>ClearPendingInsertStyleAfterNextInsert = true</c> to auto-clear after one insertion.
    /// </summary>
    private Core.Models.TextStyle? _pendingInsertStyle;
    private bool _clearPendingInsertStyleAfterNextInsert;

    private static readonly FontFamily MonoFont =
        new("Cascadia Code, Consolas, Courier New, monospace");
    private static readonly Regex TailFractionTokenRegex = new(@"\\\d+/\d+$", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>Owns all inline-equation state: layout cache, flyout, hover. Created lazily in <see cref="OnAttachedToVisualTree"/>.</summary>
    internal InlineEquationController? _equations;
    /// <summary>Delegate back-ref so controller can trigger editor rebuilds.</summary>
    internal Task RebuildInlineEquationsAsync() => _equations != null ? RebuildInlineEquationsAsyncCore() : Task.CompletedTask;
    /// <summary>Cached flag, set whenever <see cref="Spans"/> are reassigned. Avoids a per-keystroke LINQ Any scan.</summary>
    private bool _hasEquationSpans;

    /// <summary>Cached flattened text. <see cref="OnSpansChanged"/> clears this; the getter rebuilds lazily.
    /// External callers (EditableBlock, save path, etc.) hit <see cref="Text"/> multiple times per keystroke.</summary>
    private string? _cachedFlatText;

    /// <summary>Extra space so inline math ink (fractions, integrals) is not clipped vs text line metrics.</summary>
    private double _mathPadLeft, _mathPadTop, _mathPadRight, _mathPadBottom;

    /// <summary>Owns all spellcheck state; null until <see cref="OnAttachedToVisualTree"/>.</summary>
    internal SpellcheckController? _spellcheck;

    /// <summary>Services resolved once at attach-time via <see cref="RichTextServices.Resolve"/>.</summary>
    internal RichTextServices? _services;

    private sealed class AutoShortcutUndoState
    {
        public int ReplacementStart;
        public string Replacement = string.Empty;
        public string OriginalSequence = string.Empty;
        public int TextLengthAfterConversion;
    }

    // ── Routed events ────────────────────────────────────────────────────────

    public static readonly RoutedEvent<TextChangedEventArgs> TextChangedEvent =
        RoutedEvent.Register<RichTextEditor, TextChangedEventArgs>(
            nameof(TextChanged), RoutingStrategies.Bubble);

    public event EventHandler<TextChangedEventArgs>? TextChanged
    {
        add => AddHandler(TextChangedEvent, value);
        remove => RemoveHandler(TextChangedEvent, value);
    }

    /// <summary>
    /// When set, Ctrl+click on a link invokes this instead of <see cref="OpenExternalUrl"/>.
    /// Use for confirmation before leaving the app (e.g. browser / mail client).
    /// </summary>
    public Func<string, Task>? ExternalLinkNavigationRequested { get; set; }

    // ── Public API ───────────────────────────────────────────────────────────

    public IReadOnlyList<InlineSpan> Spans
    {
        get => GetValue(SpansProperty);
        set => SetValue(SpansProperty, value);
    }

    public string? Watermark
    {
        get => GetValue(WatermarkProperty);
        set => SetValue(WatermarkProperty, value);
    }

    public bool ShowInactiveWatermark
    {
        get => GetValue(ShowInactiveWatermarkProperty);
        set => SetValue(ShowInactiveWatermarkProperty, value);
    }

    public double FontSize
    {
        get => GetValue(FontSizeProperty);
        set => SetValue(FontSizeProperty, value);
    }

    public FontWeight FontWeight
    {
        get => GetValue(FontWeightProperty);
        set => SetValue(FontWeightProperty, value);
    }

    public IBrush? Foreground
    {
        get => GetValue(ForegroundProperty);
        set => SetValue(ForegroundProperty, value);
    }

    public IBrush? CaretBrush
    {
        get => GetValue(CaretBrushProperty);
        set => SetValue(CaretBrushProperty, value);
    }

    public IBrush? SelectionBrush
    {
        get => GetValue(SelectionBrushProperty);
        set => SetValue(SelectionBrushProperty, value);
    }

    public int CaretIndex
    {
        get => _caretIndex;
        set
        {
            var clamped = Math.Clamp(value, 0, TextLength);
            if (SetAndRaise(CaretIndexProperty, ref _caretIndex, clamped))
                InvalidateVisual();
        }
    }

    public int SelectionStart
    {
        get => _selectionStart;
        set
        {
            var clamped = Math.Clamp(value, 0, SelectionIndexUpperBound);
            if (SetAndRaise(SelectionStartProperty, ref _selectionStart, clamped))
                InvalidateVisual();
        }
    }

    public int SelectionEnd
    {
        get => _selectionEnd;
        set
        {
            var clamped = Math.Clamp(value, 0, SelectionIndexUpperBound);
            if (SetAndRaise(SelectionEndProperty, ref _selectionEnd, clamped))
                InvalidateVisual();
        }
    }

    /// <summary>Flat text derived from the current runs. Cached; invalidated in <see cref="OnSpansChanged"/>.</summary>
    public string Text => _cachedFlatText ??= FlattenRuns(Spans ?? Array.Empty<InlineSpan>());

    public bool IsReadOnly
    {
        get => GetValue(IsReadOnlyProperty);
        set => SetValue(IsReadOnlyProperty, value);
    }

    public bool IsSpellcheckDecorationsEnabled
    {
        get => GetValue(IsSpellcheckDecorationsEnabledProperty);
        set => SetValue(IsSpellcheckDecorationsEnabledProperty, value);
    }

    public bool ShowInlineEquationSourceOnHover
    {
        get => GetValue(ShowInlineEquationSourceOnHoverProperty);
        set => SetValue(ShowInlineEquationSourceOnHoverProperty, value);
    }

    public IReadOnlyList<SearchHighlightRange> SearchHighlightRanges
    {
        get => GetValue(SearchHighlightRangesProperty);
        set => SetValue(SearchHighlightRangesProperty, value);
    }

    public SearchHighlightRange? ActiveSearchHighlightRange
    {
        get => GetValue(ActiveSearchHighlightRangeProperty);
        set => SetValue(ActiveSearchHighlightRangeProperty, value);
    }

    public int TextLength => Text.Length;

    /// <summary>
    /// Max selection index (half-open range). Empty text uses 1 so cross-block drag can highlight blank
    /// paragraphs; <see cref="CaretIndex"/> still clamps to <see cref="TextLength"/> (0).
    /// </summary>
    public int SelectionIndexUpperBound => TextLength == 0 ? 1 : TextLength;

    // ── Initialisation ───────────────────────────────────────────────────────

    static RichTextEditor()
    {
        FocusableProperty.OverrideDefaultValue<RichTextEditor>(true);
        CursorProperty.OverrideDefaultValue<RichTextEditor>(new Cursor(StandardCursorType.Ibeam));
        ClipToBoundsProperty.OverrideDefaultValue<RichTextEditor>(false);
        MinWidthProperty.OverrideDefaultValue<RichTextEditor>(2.0);
        SpansProperty.Changed.AddClassHandler<RichTextEditor>((o, _) => o.OnSpansChanged());
        FontSizeProperty.Changed.AddClassHandler<RichTextEditor>((o, e) =>
        {
            if (o._equations != null) o._equations.IsDirty = true;
            o.InvalidateLayout();
#pragma warning disable CS4014
            o.RebuildInlineEquationsAsync();
#pragma warning restore CS4014
        });
        FontWeightProperty.Changed.AddClassHandler<RichTextEditor>((o, _) => o.InvalidateLayout());
        ForegroundProperty.Changed.AddClassHandler<RichTextEditor>((o, _) => o.InvalidateLayout());
        WatermarkProperty.Changed.AddClassHandler<RichTextEditor>((o, _) => o.InvalidateLayout());
        ShowInactiveWatermarkProperty.Changed.AddClassHandler<RichTextEditor>((o, _) => o.InvalidateVisual());
        ShowInlineEquationSourceOnHoverProperty.Changed.AddClassHandler<RichTextEditor>((o, _) =>
        {
            o._equations?.SetHovered(null);
            o.InvalidateVisual();
        });
        SearchHighlightRangesProperty.Changed.AddClassHandler<RichTextEditor>((o, _) => o.InvalidateVisual());
        ActiveSearchHighlightRangeProperty.Changed.AddClassHandler<RichTextEditor>((o, _) => o.InvalidateVisual());
        IsReadOnlyProperty.Changed.AddClassHandler<RichTextEditor>((o, _) => o.OnSpellcheckDecorationGateChanged());
        IsSpellcheckDecorationsEnabledProperty.Changed.AddClassHandler<RichTextEditor>((o, _) => o.OnSpellcheckDecorationGateChanged());
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        // Do NOT start caret timer here; timer fires every 530ms causing repaints on all realized editors.
        // Started in OnGotFocus, stopped in OnLostFocus.
        _services = RichTextServices.Resolve();
        _equations = new InlineEquationController(this, _services.LaTeX);
        _spellcheck = new SpellcheckController(this, _services.Spellcheck, _services.Settings);
        _ = _spellcheck.InitializeAsync();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        StopCaretTimer();
        _equations?.Detach();
        _equations = null;
        _spellcheck?.Detach();
        _spellcheck = null;
        DisposeLayouts();
    }

    void IRichTextEditorHost.InvalidateEditorVisual() => InvalidateVisual();

    void IRichTextEditorHost.InvalidateEditorMeasure() => InvalidateMeasure();

    Rect IRichTextEditorHost.EditorBounds => Bounds;

    TextLayout? IRichTextEditorHost.ForegroundTextLayout => _textLayout;

    int IRichTextEditorHost.LogicalToLayoutBoundary(int logicalIndex) => LogicalCaretToLayoutBoundary(logicalIndex);

}

