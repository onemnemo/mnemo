using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.UI.Components.BlockEditor;

public partial class BlockViewModel
{
    public BlockViewModel(BlockType type, string content = "", int order = 0)
    {
        _id = Guid.NewGuid().ToString();
        _type = type;
        var defaultStyle = type is BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4 ? new TextStyle(Bold: true) : TextStyle.Default;
        _spans = new List<InlineSpan> { new TextSpan(content ?? string.Empty, defaultStyle) };
        _cachedFlatContent = content ?? string.Empty;
        _meta = new Dictionary<string, object>();
        _order = order;
        if (type == BlockType.Code)
            _codeLanguage = "csharp";

        EnsureMetaKeys();
    }

    public BlockViewModel(Block block)
    {
        _id = string.IsNullOrEmpty(block.Id) ? Guid.NewGuid().ToString() : block.Id;
        _type = block.Type;
        _meta = new Dictionary<string, object>(block.Meta ?? new Dictionary<string, object>());
        _order = block.Order;

        ApplyPayloadFieldsToMeta(block.Payload, _meta);
        InitImageFromBlock(block);
        InitSketchFromBlock(block);
        InitListNumberIndexFromMeta();

        block.EnsureSpans();
        _spans = InlineSpanFormatApplier.Normalize(block.Spans);
        if (_spans.Count == 0)
            _spans.Add(InlineSpan.Plain(string.Empty));
        EnsureHeadingBold();

        // Apply autolink so URLs stored as plain text (e.g. older notes, imports) get link
        // styling immediately on load rather than only after the first keystroke.
        if (_type != BlockType.Code)
        {
            var loadFlat = InlineSpanFormatApplier.Flatten(_spans);
            if (MayContainAutoLink(loadFlat))
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

        EnsureMetaKeys();

        if (_type == BlockType.Image
            && string.IsNullOrWhiteSpace(_cachedFlatContent)
            && block.Payload is ImagePayload ipSeed
            && !string.IsNullOrWhiteSpace(ipSeed.Alt))
            SetSpans(new List<InlineSpan> { InlineSpan.Plain(ipSeed.Alt) });

        if (_type == BlockType.Code)
            InitCodeLanguageFromBlock(block);

        if (_type == BlockType.Equation)
            InitEquationFromBlock(block);

        if (_type == BlockType.Checklist)
            InitChecklistFromBlock(block);

        if (_type == BlockType.Page)
            InitPageFromBlock(block);
    }

    private static string ReadMetaString(Dictionary<string, object> meta, string key)
    {
        if (!meta.TryGetValue(key, out var val) || val == null) return string.Empty;
        if (val is string s) return s;
        if (val is JsonElement je && je.ValueKind == JsonValueKind.String) return je.GetString() ?? string.Empty;
        return val.ToString() ?? string.Empty;
    }

    private static int ReadMetaInt(Dictionary<string, object> meta, string key, int fallback)
    {
        if (!meta.TryGetValue(key, out var val) || val == null) return fallback;
        if (val is int i) return i;
        if (val is long l && l >= int.MinValue && l <= int.MaxValue) return (int)l;
        if (val is JsonElement je && je.TryGetInt32(out var parsed)) return parsed;
        return int.TryParse(val.ToString(), out var fromString) ? fromString : fallback;
    }

    private void InitListNumberIndexFromMeta()
    {
        if (_type != BlockType.NumberedList)
            return;

        _listNumberIndex = Math.Max(1, ReadMetaInt(_meta, ListNumberIndexMetaKey, 1));
    }

    private static void ApplyPayloadFieldsToMeta(BlockPayload payload, Dictionary<string, object> meta)
    {
        switch (payload)
        {
            case EmptyPayload:
                break;
            case EquationPayload:
                break;
            case ImagePayload:
                break;
            case CodePayload:
                break;
            case ChecklistPayload:
                break;
            case TwoColumnPayload:
                break;
            case PagePayload:
                break;
            case SketchPayload:
                break;
            default:
                throw new UnreachableException($"Unexpected block payload type: {payload.GetType().Name}");
        }
    }

    /// <summary>Removes flat-pair column keys from a cell once it is wired under a <see cref="TwoColumnBlockViewModel"/>.</summary>
    internal void StripColumnLayoutMetaAsNestedCell()
    {
        var changed = false;
        if (_meta.Remove(ColumnPairHelper.PairIdKey)) changed = true;
        if (_meta.Remove(ColumnPairHelper.SideKey)) changed = true;
        if (_meta.Remove("columnSplitRatio")) changed = true;
        if (changed)
            OnPropertyChanged(nameof(Meta));
    }

    private static bool ReadCheckedFromMeta(Dictionary<string, object> meta)
    {
        if (!meta.TryGetValue("checked", out var value) || value == null)
            return false;
        if (value is bool b)
            return b;
        if (value is JsonElement je && je.ValueKind == JsonValueKind.True)
            return true;
        return false;
    }

    private void InitCodeLanguageFromBlock(Block block)
    {
        if (block.Payload is CodePayload cp)
        {
            _codeLanguage = string.IsNullOrWhiteSpace(cp.Language) ? "csharp" : cp.Language.Trim();
            _codeWrap = cp.Wrap;
            _codeNumbers = cp.Numbers;
            _codeCaption = cp.Caption ?? string.Empty;
        }
        else
            _codeLanguage = string.IsNullOrWhiteSpace(ReadMetaString(_meta, "language")) ? "csharp" : ReadMetaString(_meta, "language");
        if (_meta.Remove("language"))
            OnPropertyChanged(nameof(Meta));
    }

    private void InitEquationFromBlock(Block block)
    {
        if (block.Payload is EquationPayload ep)
            _equationLatex = ep.Latex ?? string.Empty;
        else
            _equationLatex = ReadMetaString(_meta, "equationLatex");
        if (_meta.Remove("equationLatex"))
            OnPropertyChanged(nameof(Meta));
    }

    private void InitChecklistFromBlock(Block block)
    {
        if (block.Payload is ChecklistPayload cp)
            _checklistChecked = cp.Checked;
        else
            _checklistChecked = ReadCheckedFromMeta(_meta);
        if (_meta.Remove("checked"))
            OnPropertyChanged(nameof(Meta));
    }

    private void InitPageFromBlock(Block block)
    {
        if (block.Payload is PagePayload pp)
            _referenceNoteId = pp.ReferenceNoteId ?? string.Empty;
        else
            _referenceNoteId = ReadMetaString(_meta, "reference_note_id");
        if (_meta.Remove("reference_note_id"))
            OnPropertyChanged(nameof(Meta));
        SetSpans(new List<InlineSpan> { InlineSpan.Plain(string.Empty) });
        OnPropertyChanged(nameof(ReferenceNoteId));
    }

    private void InitSketchFromBlock(Block block)
    {
        if (block.Type != BlockType.Sketch)
            return;

        if (block.Payload is SketchPayload sp)
        {
            _sketchWidth = sp.Width;
            _sketchAlign = NormalizeImageAlign(sp.Align);
        }

        OnPropertyChanged(nameof(SketchWidth));
        OnPropertyChanged(nameof(SketchAlign));
    }

    private void InitImageFromBlock(Block block)
    {
        if (block.Type != BlockType.Image)
            return;

        string path;
        double width;
        string align;
        if (block.Payload is ImagePayload ip)
        {
            path = ip.Path ?? string.Empty;
            width = ip.Width;
            align = string.IsNullOrWhiteSpace(ip.Align) ? "left" : ip.Align.Trim();
        }
        else
        {
            path = ReadMetaString(_meta, "imagePath");
            width = ReadMetaDouble(_meta, "imageWidth");
            align = ReadMetaString(_meta, "imageAlign");
        }

        var metaChanged = false;
        foreach (var k in new[] { "imagePath", "imageAlt", "imageWidth", "imageAlign" })
            metaChanged |= _meta.Remove(k);

        _imagePath = path;
        _imageWidth = width;
        _imageAlign = NormalizeImageAlign(align);
        if (metaChanged)
            OnPropertyChanged(nameof(Meta));
        OnPropertyChanged(nameof(ImagePath));
        OnPropertyChanged(nameof(ImageWidth));
        OnPropertyChanged(nameof(ImageAlign));
    }

    private static double ReadMetaDouble(Dictionary<string, object> meta, string key)
    {
        if (!meta.TryGetValue(key, out var v) || v == null) return 0;
        if (v is double d) return d;
        if (v is int i) return i;
        if (v is JsonElement je && je.TryGetDouble(out var x)) return x;
        return 0;
    }

    private BlockPayload BuildPayloadForPersistence()
    {
        return Type switch
        {
            BlockType.Equation => new EquationPayload(_equationLatex),
            BlockType.Checklist => new ChecklistPayload(_checklistChecked),
            BlockType.Code => new CodePayload(_codeLanguage, InlineSpanText.FlattenDisplay(_spans), _codeWrap, _codeNumbers, _codeCaption),
            BlockType.Image => new ImagePayload(
                _imagePath,
                InlineSpanText.FlattenDisplay(_spans),
                _imageWidth,
                _imageAlign),
            BlockType.Page => new PagePayload(_referenceNoteId),
            BlockType.Sketch => new SketchPayload(_sketchWidth, _sketchAlign),
            _ => new EmptyPayload()
        };
    }
    
    private void EnsureMetaKeys()
    {
        bool metaChanged = false;

        if (_type != BlockType.Image)
        {
            foreach (var k in new[] { "imagePath", "imageAlt", "imageWidth", "imageAlign" })
            {
                if (_meta.Remove(k))
                    metaChanged = true;
            }
        }

        if (_type != BlockType.Code && _meta.Remove("language"))
            metaChanged = true;

        if (_type != BlockType.Equation && _meta.Remove("equationLatex"))
            metaChanged = true;

        if (_type != BlockType.Checklist && _meta.Remove("checked"))
            metaChanged = true;

        if (_type != BlockType.Page && _meta.Remove("reference_note_id"))
            metaChanged = true;

        if (_type != BlockType.NumberedList && _meta.Remove(ListNumberIndexMetaKey))
            metaChanged = true;

        if (OwnerTwoColumn != null)
        {
            if (_meta.Remove(ColumnPairHelper.PairIdKey)) metaChanged = true;
            if (_meta.Remove(ColumnPairHelper.SideKey)) metaChanged = true;
            if (_meta.Remove("columnSplitRatio")) metaChanged = true;
        }

        if (metaChanged)
        {
            OnPropertyChanged(nameof(Meta));
            OnPropertyChanged(nameof(IsChecked));
        }
    }

    /// <summary>When non-null, this block lives inside a <see cref="TwoColumnBlockViewModel"/> column (not a top-level row).</summary>
    public TwoColumnBlockViewModel? OwnerTwoColumn { get; internal set; }

    /// <summary>Which column of <see cref="OwnerTwoColumn"/> this block belongs to.</summary>
    public bool IsLeftColumn { get; internal set; }

    public virtual Block ToBlock()
    {
        var block = new Block
        {
            Id = Id,
            Type = Type,
            Spans = new List<InlineSpan>(_spans),
            Payload = BuildPayloadForPersistence(),
            Meta = new Dictionary<string, object>(Meta),
            Order = Order
        };

        if (Type == BlockType.NumberedList)
            block.Meta[ListNumberIndexMetaKey] = ListNumberIndex;

        if (Type == BlockType.Code)
            block.Meta.Remove("language");
        if (Type == BlockType.Equation)
            block.Meta.Remove("equationLatex");
        if (Type == BlockType.Checklist)
            block.Meta.Remove("checked");
        if (Type == BlockType.Image)
        {
            foreach (var k in new[] { "imagePath", "imageAlt", "imageWidth", "imageAlign" })
                block.Meta.Remove(k);
        }

        if (Type == BlockType.Page)
            block.Meta.Remove("reference_note_id");

        return block;
    }

    /// <summary>
    /// Reapplies payload-backed fields from a history snapshot to an existing view model.
    /// <see cref="ToBlock"/> serializes these into <see cref="Block.Payload"/>, but undo/redo
    /// restores existing VMs in-place (SetSpans/Type/Meta) which never reads the payload back —
    /// without this, e.g. a Page block loses its <see cref="ReferenceNoteId"/> after undo/redo.
    /// Call after <see cref="Type"/> has been set to the snapshot's type.
    /// </summary>
    internal void ApplyPayloadFromHistorySnapshot(Block blk)
    {
        switch (blk.Payload)
        {
            case PagePayload pp when _type == BlockType.Page:
                ReferenceNoteId = pp.ReferenceNoteId ?? string.Empty;
                break;
            case EquationPayload ep when _type == BlockType.Equation:
                EquationLatex = ep.Latex ?? string.Empty;
                break;
            case CodePayload cp when _type == BlockType.Code:
                CodeLanguage = cp.Language;
                _codeWrap = cp.Wrap;
                _codeNumbers = cp.Numbers;
                _codeCaption = cp.Caption ?? string.Empty;
                break;
            case ChecklistPayload chk when _type == BlockType.Checklist:
                IsChecked = chk.Checked;
                break;
            case ImagePayload ip when _type == BlockType.Image:
                ImagePath = ip.Path ?? string.Empty;
                ImageWidth = ip.Width;
                ImageAlign = ip.Align;
                break;
            case SketchPayload sp when _type == BlockType.Sketch:
                SketchWidth = sp.Width;
                SketchAlign = sp.Align;
                break;
        }
    }

    public void NotifyContentChanged()
    {
        ContentChanged?.Invoke(this);
    }

    public void NotifyStructuralChangeStarting()
    {
        StructuralChangeStarting?.Invoke();
    }

    public void NotifyStructuralChangeCompleted(string description)
    {
        StructuralChangeCompleted?.Invoke(description);
    }

    public void RequestDelete()
    {
        DeleteRequested?.Invoke(this);
    }

    public void RequestDuplicateBlock()
    {
        DuplicateBlockRequested?.Invoke(this);
    }

    public void RequestNewBlock(string? initialContentForNewBlock = null)
    {
        NewBlockRequested?.Invoke(this, initialContentForNewBlock);
    }

    public void RequestNewBlockOfType(BlockType type, string? initialContentForNewBlock = null)
    {
        NewBlockOfTypeRequested?.Invoke(this, type, initialContentForNewBlock);
    }

    /// <summary>Inserts an empty text block above this block (e.g. Enter at start of line).</summary>
    public void RequestNewBlockAbove(string? initialContentForNewBlock = null)
    {
        NewBlockAboveRequested?.Invoke(this, initialContentForNewBlock);
    }

}
