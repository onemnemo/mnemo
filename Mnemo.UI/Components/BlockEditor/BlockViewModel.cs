using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Avalonia;
using Avalonia.Input;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI;
using Mnemo.UI.Input;

namespace Mnemo.UI.Components.BlockEditor;

public partial class BlockViewModel : INotifyPropertyChanged
{
    /// <summary>Drag-and-drop format for reordering blocks in the editor.</summary>
    public static readonly DataFormat<BlockViewModel> BlockDragDataFormat =
        AvaloniaDataFormats.CreateApplicationFormat<BlockViewModel>("BlockViewModel");

    /// <summary>Primary block (handle source) plus all blocks to move together (document order).</summary>
    public sealed class BlockReorderDragPayload
    {
        public required BlockViewModel Primary { get; init; }
        public required IReadOnlyList<BlockViewModel> BlocksInDocumentOrder { get; init; }
        public Point? DragStartPointInEditor { get; init; }

        public static readonly DataFormat<BlockReorderDragPayload> Format =
            AvaloniaDataFormats.CreateApplicationFormat<BlockReorderDragPayload>("BlockReorderDragPayload");
    }

    private string _id;
    private BlockType _type;
    private List<InlineSpan> _spans = new() { InlineSpan.Plain(string.Empty) };
    private string _cachedFlatContent = string.Empty;
    private Dictionary<string, object> _meta;
    private int _order;
    private int _listNumberIndex = 1;
    private const string ListNumberIndexMetaKey = "listNumberIndex";
    /// <summary>Fenced code language; canonical with <see cref="CodePayload"/> on persist. Not stored in <see cref="Meta"/>.</summary>
    private string _codeLanguage = "csharp";

    /// <summary>
    /// Code display state this editor has no control for. Carried through from load to persist so
    /// opening a note here does not silently clear choices made elsewhere.
    /// </summary>
    private bool _codeWrap;
    private bool _codeNumbers;
    private string _codeCaption = string.Empty;

    /// <summary>Standalone equation LaTeX; canonical with <see cref="EquationPayload"/> on persist. Not stored in <see cref="Meta"/>.</summary>
    private string _equationLatex = string.Empty;

    /// <summary>Checklist checked state; canonical with <see cref="ChecklistPayload"/> on persist. Not stored in <see cref="Meta"/>.</summary>
    private bool _checklistChecked;

    /// <summary>Image asset path; canonical with <see cref="ImagePayload.Path"/> on persist. Not stored in <see cref="Meta"/>.</summary>
    private string _imagePath = string.Empty;

    /// <summary>Image display width (0 = natural). Canonical with <see cref="ImagePayload.Width"/>.</summary>
    private double _imageWidth;

    /// <summary>Image horizontal alignment: left, center, right. Canonical with <see cref="ImagePayload.Align"/>.</summary>
    private string _imageAlign = "left";

    /// <summary>Sketch display width (0 = natural). Canonical with <see cref="SketchPayload.Width"/>.</summary>
    private double _sketchWidth;

    /// <summary>Sketch horizontal alignment: left, center, right. Canonical with <see cref="SketchPayload.Align"/>.</summary>
    private string _sketchAlign = "left";

    /// <summary>Target note id for <see cref="BlockType.Page"/>; title always comes from <see cref="ReferencedNoteTitle"/> / resolver.</summary>
    private string _referenceNoteId = string.Empty;

    private string _referencedNoteTitle = string.Empty;
    private string _pageBlockSubtitle = string.Empty;

    public string Id
    {
        get => _id;
        set { _id = value; OnPropertyChanged(); }
    }

    public BlockType Type
    {
        get => _type;
        set 
        { 
            if (_type != value)
            {
                var wasHeading = _type is BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4;
                var prevType = _type;
                _type = value;
                if (value != BlockType.Checklist)
                    _checklistChecked = false;
                else if (prevType != BlockType.Checklist)
                {
                    _checklistChecked = ReadCheckedFromMeta(_meta);
                    if (_meta.Remove("checked"))
                        OnPropertyChanged(nameof(Meta));
                }

                if (value is BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4)
                {
                    EnsureHeadingBold();
                    OnPropertyChanged(nameof(Content));
                    OnPropertyChanged(nameof(Spans));
                }
                else if (wasHeading)
                {
                    StripHeadingBoldFromRuns();
                }
                if (value == BlockType.Code && prevType != BlockType.Code)
                    _codeLanguage = "csharp";

                if (prevType == BlockType.Image && value != BlockType.Image)
                {
                    _imagePath = string.Empty;
                    _imageWidth = 0;
                    _imageAlign = "left";
                }

                if (value == BlockType.Image && prevType != BlockType.Image)
                {
                    _imagePath = ReadMetaString(_meta, "imagePath");
                    _imageWidth = ReadMetaDouble(_meta, "imageWidth");
                    _imageAlign = NormalizeImageAlign(ReadMetaString(_meta, "imageAlign"));
                    var legacyAlt = ReadMetaString(_meta, "imageAlt");
                    var metaChanged = false;
                    foreach (var k in new[] { "imagePath", "imageAlt", "imageWidth", "imageAlign" })
                        metaChanged |= _meta.Remove(k);
                    if (metaChanged)
                        OnPropertyChanged(nameof(Meta));
                    if (!string.IsNullOrEmpty(legacyAlt) && string.IsNullOrWhiteSpace(InlineSpanText.FlattenDisplay(_spans)))
                        SetSpans(new List<InlineSpan> { InlineSpan.Plain(legacyAlt) });
                }

                if (prevType == BlockType.Sketch && value != BlockType.Sketch)
                {
                    _sketchWidth = 0;
                    _sketchAlign = "left";
                }

                if (prevType == BlockType.Page && value != BlockType.Page)
                {
                    _referenceNoteId = string.Empty;
                    _referencedNoteTitle = string.Empty;
                    _pageBlockSubtitle = string.Empty;
                    OnPropertyChanged(nameof(ReferenceNoteId));
                    OnPropertyChanged(nameof(ReferencedNoteTitle));
                    OnPropertyChanged(nameof(PageBlockSubtitle));
                }

                if (value == BlockType.Page && prevType != BlockType.Page)
                {
                    SetSpans(new List<InlineSpan> { InlineSpan.Plain(string.Empty) });
                }

                EnsureMetaKeys();

                OnPropertyChanged();
                OnPropertyChanged(nameof(Watermark));
                if (value == BlockType.Code || prevType == BlockType.Code)
                    OnPropertyChanged(nameof(CodeLanguage));
                if (value == BlockType.Equation || prevType == BlockType.Equation)
                    OnPropertyChanged(nameof(EquationLatex));
                if (value == BlockType.Checklist || prevType == BlockType.Checklist)
                    OnPropertyChanged(nameof(IsChecked));
                if (value == BlockType.Image || prevType == BlockType.Image)
                {
                    OnPropertyChanged(nameof(ImagePath));
                    OnPropertyChanged(nameof(ImageWidth));
                    OnPropertyChanged(nameof(ImageAlign));
                }
                if (value == BlockType.Sketch || prevType == BlockType.Sketch)
                {
                    OnPropertyChanged(nameof(SketchWidth));
                    OnPropertyChanged(nameof(SketchAlign));
                }
                if (value == BlockType.Page || prevType == BlockType.Page)
                {
                    OnPropertyChanged(nameof(ReferenceNoteId));
                    OnPropertyChanged(nameof(ReferencedNoteTitle));
                    OnPropertyChanged(nameof(PageBlockSubtitle));
                }
            }
        }
    }

    /// <summary>Stored image file path for <see cref="BlockType.Image"/> blocks.</summary>
    public string ImagePath
    {
        get => _imagePath;
        set
        {
            var v = value ?? string.Empty;
            if (_imagePath == v) return;
            _imagePath = v;
            OnPropertyChanged();
            if (_type == BlockType.Image)
                ContentChanged?.Invoke(this);
        }
    }

    /// <summary>Display width in layout units; 0 means use natural size.</summary>
    public double ImageWidth
    {
        get => _imageWidth;
        set
        {
            if (Math.Abs(_imageWidth - value) < double.Epsilon) return;
            _imageWidth = value;
            OnPropertyChanged();
            if (_type == BlockType.Image)
                ContentChanged?.Invoke(this);
        }
    }

    /// <summary>Horizontal alignment for image layout: left, center, or right.</summary>
    public string ImageAlign
    {
        get => _imageAlign;
        set
        {
            var v = NormalizeImageAlign(value);
            if (_imageAlign == v) return;
            _imageAlign = v;
            OnPropertyChanged();
            if (_type == BlockType.Image)
                ContentChanged?.Invoke(this);
        }
    }

    private static string NormalizeImageAlign(string? value) =>
        value?.Trim().ToLowerInvariant() switch
        {
            "center" => "center",
            "right" => "right",
            _ => "left",
        };

    /// <summary>Display width in layout units; 0 means use natural size.</summary>
    public double SketchWidth
    {
        get => _sketchWidth;
        set
        {
            if (Math.Abs(_sketchWidth - value) < double.Epsilon) return;
            _sketchWidth = value;
            OnPropertyChanged();
            if (_type == BlockType.Sketch)
                ContentChanged?.Invoke(this);
        }
    }

    /// <summary>Horizontal alignment for sketch layout: left, center, or right.</summary>
    public string SketchAlign
    {
        get => _sketchAlign;
        set
        {
            var v = NormalizeImageAlign(value);
            if (_sketchAlign == v) return;
            _sketchAlign = v;
            OnPropertyChanged();
            if (_type == BlockType.Sketch)
                ContentChanged?.Invoke(this);
        }
    }

    /// <summary>Referenced sub-note id for <see cref="BlockType.Page"/> blocks.</summary>
    public string ReferenceNoteId
    {
        get => _referenceNoteId;
        set
        {
            var v = value ?? string.Empty;
            if (_referenceNoteId == v) return;
            _referenceNoteId = v;
            OnPropertyChanged();
            if (_type == BlockType.Page)
                ContentChanged?.Invoke(this);
        }
    }

    /// <summary>Resolved title for the page button; refresh via <see cref="RefreshPageButtonTitle"/>.</summary>
    public string ReferencedNoteTitle
    {
        get => _referencedNoteTitle;
        private set
        {
            var v = value ?? string.Empty;
            if (_referencedNoteTitle == v) return;
            _referencedNoteTitle = v;
            OnPropertyChanged();
        }
    }

    /// <summary>Second line under the title (e.g. â€œOpen pageâ€ and optional nested count). Set by <see cref="RefreshPageButtonTitle"/>.</summary>
    public string PageBlockSubtitle
    {
        get => _pageBlockSubtitle;
        private set
        {
            var v = value ?? string.Empty;
            if (_pageBlockSubtitle == v) return;
            _pageBlockSubtitle = v;
            OnPropertyChanged();
        }
    }

    /// <summary>Updates <see cref="ReferencedNoteTitle"/> from <paramref name="lookup"/>; uses <paramref name="missingTitle"/> when the note is missing or empty.</summary>
    public void RefreshPageButtonTitle(Func<string, string?>? lookup, string missingTitle, Func<string, int>? childPageCountLookup = null)
    {
        if (_type != BlockType.Page) return;
        var t = lookup?.Invoke(_referenceNoteId);
        ReferencedNoteTitle = string.IsNullOrWhiteSpace(t) ? missingTitle : t;

        var loc = (Application.Current as App)?.Services?.GetService(typeof(ILocalizationService)) as ILocalizationService;
        string T(string key, string fallback, string ns = "NotesEditor")
        {
            var s = loc?.T(key, ns);
            return string.IsNullOrEmpty(s) ? fallback : s;
        }

        var openLine = T("PageBlockOpenPage", "Open page");
        var nested = childPageCountLookup?.Invoke(_referenceNoteId) ?? 0;
        if (nested > 0)
        {
            var suffixFmt = nested == 1
                ? T("PageBlockNestedPageCountOne", "â€¢ {0} nested page")
                : T("PageBlockNestedPageCountMany", "â€¢ {0} nested pages");
            PageBlockSubtitle = $"{openLine}  {string.Format(suffixFmt, nested)}";
        }
        else
            PageBlockSubtitle = openLine;
    }

    /// <summary>Programming language id for fenced code blocks (e.g. csharp, python). Ignored when <see cref="Type"/> is not <see cref="BlockType.Code"/>.</summary>
    public string CodeLanguage
    {
        get => _codeLanguage;
        set
        {
            var v = string.IsNullOrWhiteSpace(value) ? "csharp" : value.Trim();
            if (_codeLanguage == v) return;
            _codeLanguage = v;
            OnPropertyChanged();
        }
    }

    /// <summary>LaTeX source for <see cref="BlockType.Equation"/> blocks. Ignored for other types.</summary>
    public string EquationLatex
    {
        get => _equationLatex;
        set
        {
            var v = value ?? string.Empty;
            if (_equationLatex == v) return;
            _equationLatex = v;
            OnPropertyChanged();
            if (_type == BlockType.Equation)
                ContentChanged?.Invoke(this);
        }
    }

    /// <summary>
    /// Flattened plain text view of the inline runs.
    /// Setting this applies a text diff to the run list, preserving styles outside the edit region.
    /// </summary>
    public string Content
    {
        get => _cachedFlatContent;
        set
        {
            var newText = value ?? string.Empty;
            if (_cachedFlatContent == newText)
                return;

            _previousContent = _cachedFlatContent;
            _previousSpans = CloneSpans();
            _spans = InlineSpanFormatApplier.ApplyTextEdit(_spans, _cachedFlatContent, newText);
            EnsureHeadingBold();
            if (_type != BlockType.Code)
            {
                var autolinked = InlineSpanFormatApplier.Normalize(InlineAutoLink.Apply(_spans));
                if (!SpansListContentEqual(_spans, autolinked))
                {
                    _spans = autolinked;
                    EnsureHeadingBold();
                }
            }

            _cachedFlatContent = InlineSpanFormatApplier.Flatten(_spans);
            OnPropertyChanged();
            OnPropertyChanged(nameof(Watermark));
            OnPropertyChanged(nameof(Spans));
            ContentChanged?.Invoke(this);
        }
    }

    /// <summary>
    /// The structured inline runs (source of truth for rich text).
    /// </summary>

    public Dictionary<string, object> Meta
    {
        get => _meta;
        set 
        { 
            _meta = value ?? new Dictionary<string, object>(); 
            EnsureMetaKeys();
            OnPropertyChanged(); 
        }
    }

    public int Order
    {
        get => _order;
        set => _order = value;
    }

    public int ListNumberIndex
    {
        get => _listNumberIndex;
        set
        {
            if (_listNumberIndex != value)
            {
                _listNumberIndex = value;
                OnPropertyChanged();
                OnPropertyChanged(nameof(ListNumber));
            }
        }
    }

    public string ListNumber => $"{_listNumberIndex}.";


    /// <summary>
    /// Set by EditableBlock just before NotifyContentChanged to carry the pre-edit text.
    /// Consumed and cleared by the history system. Not persisted.
    /// </summary>
    public string? PreviousContent
    {
        get => _previousContent;
        set => _previousContent = value;
    }

    /// <summary>
    /// Set alongside PreviousContent to carry the pre-edit formatting runs.
    /// </summary>
    public List<InlineSpan>? PreviousSpans
    {
        get => _previousSpans;
        set => _previousSpans = value;
    }

    public bool IsChecked
    {
        get => _type == BlockType.Checklist && _checklistChecked;
        set
        {
            if (_type != BlockType.Checklist || _checklistChecked == value)
                return;
            NotifyStructuralChangeStarting();
            _checklistChecked = value;
            OnPropertyChanged();
            ContentChanged?.Invoke(this);
        }
    }

    public string Watermark
    {
        get
        {
            var loc = (Application.Current as App)?.Services?.GetService(typeof(ILocalizationService)) as ILocalizationService;
            string T(string key, string ns = "NotesEditor") => loc?.T(key, ns) ?? key;

            // Placeholders only on the empty block that has keyboard focus (avoids ghost watermarks when adding blocks).
            if (!IsFocused || !BlockEditorContentPolicy.IsVisuallyEmpty(Content))
                return string.Empty;

            return Type switch
            {
                BlockType.Text => T("TypeSlashForCommands"),
                BlockType.Heading1 => T("Heading1"),
                BlockType.Heading2 => T("Heading2"),
                BlockType.Heading3 => T("Heading3"),
                BlockType.Heading4 => T("Heading4"),
                BlockType.Quote => T("Quote"),
                BlockType.Code => T("Code"),
                BlockType.BulletList => T("ListItem"),
                BlockType.NumberedList => T("ListItem"),
                BlockType.Checklist => T("ChecklistItem"),
                BlockType.Image => string.Empty,
                BlockType.Page => string.Empty,
                _ => string.Empty
            };
        }
    }

    /// <summary>Left column width fraction (0.1â€“0.9). Legacy: stored on the left block of a flat pair in <see cref="Meta"/>; nested splits use <see cref="TwoColumnBlockViewModel"/>.</summary>
    public virtual double ColumnSplitRatio
    {
        get
        {
            if (_meta.TryGetValue("columnSplitRatio", out var v))
            {
                if (v is double d) return Math.Clamp(d, 0.1, 0.9);
                if (v is JsonElement je && je.ValueKind == JsonValueKind.Number)
                    return Math.Clamp(je.GetDouble(), 0.1, 0.9);
            }
            return 0.5;
        }
        set
        {
            var r = Math.Clamp(value, 0.1, 0.9);
            _meta["columnSplitRatio"] = r;
            OnPropertyChanged();
        }
    }

    /// <summary>Other block in the same side-by-side pair, if any (uses <c>columnPairId</c> meta).</summary>
    public BlockViewModel? GetColumnSibling(IReadOnlyList<BlockViewModel> document) =>
        ColumnPairHelper.GetSibling(this, document);

    public event Action<BlockViewModel>? ContentChanged;
    public event Action<BlockViewModel>? DeleteRequested;
    /// <summary>Duplicate this block (e.g. image: copy asset into a new block below).</summary>
    public event Action<BlockViewModel>? DuplicateBlockRequested;
    public event Action<BlockViewModel, string?>? NewBlockRequested;
    /// <summary>Third argument is initial plain text for the new block (e.g. Enter split).</summary>
    public event Action<BlockViewModel, BlockType, string?>? NewBlockOfTypeRequested;
    public event Action<BlockViewModel, string?>? NewBlockAboveRequested;
    /// <summary>
    /// Raised before a structural change (Enter split, backspace merge, type change)
    /// so the editor can snapshot the document while VMs are still unmodified.
    /// </summary>
    public event Action? StructuralChangeStarting;
    public event Action<string>? StructuralChangeCompleted;

    public event PropertyChangedEventHandler? PropertyChanged;

    protected virtual void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
