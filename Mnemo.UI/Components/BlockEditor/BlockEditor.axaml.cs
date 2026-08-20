using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Avalonia.Layout;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Formatting;
using Mnemo.Core.History;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.UI.Components.BlockEditor.History;
using Mnemo.UI.Services;

namespace Mnemo.UI.Components.BlockEditor;

public partial class BlockEditor : UserControl, INotifyPropertyChanged, IEditorHost
{
    internal ObservableCollection<BlockViewModel> _blocks = new();

    /// <summary>Visual rows (one item per stack row; split pairs are one row with two <see cref="EditableBlock"/>s).</summary>
    /// <remarks>
    /// Full rebuilds replace the <see cref="ObservableCollection{T}"/> instance (see <see cref="RebuildBlockRows"/>)
    /// so <see cref="ItemsRepeater"/> receives one binding refresh instead of Clear + N Add notifications.
    /// </remarks>
    public ObservableCollection<BlockRowViewModelBase> BlockRows => _blockRows;

    internal ObservableCollection<BlockRowViewModelBase> _blockRows = new();

    /// <summary>Top-level <see cref="Blocks"/> index for the row containing keyboard focus (split row = one index).</summary>
    internal int _focusedBlockIndex = -1;

    /// <summary>Leaf block id with keyboard focus (including nested split cells).</summary>
    internal string? _focusedBlockId;

    // Drag-box block selection (Mode 2)
    private bool _isBoxSelecting;
    private bool _boxSelectArmed;   // true after pointer-down outside blocks, waiting for threshold
    private Point _boxSelectStart;   // editor space (for hit-test)
    private Point _boxSelectStartInOverlay; // overlay space (for drawing); set when arming
    private Border? _selectionBoxBorder;
    private const double BoxSelectThreshold = 6.0; // pixels to move before box appears
    /// <summary>Anchor for Shift+click range on drag handles; reset when block selection is cleared.</summary>
    private int _blockDragHandleSelectionAnchorIndex = -1;
    internal bool _isColumnSplitResizing;
    /// <summary>Horizontal padding on EditorRoot; selection box Margin is relative to the padded content area.</summary>
    private const double EditorContentPaddingX = 32.0;

    private LayoutOverlayPanel? _blockDragGhostOverlay;
    private Border? _blockDragGhostBorder;
    private Vector _blockDragGhostPointerOffset;
    private const double BlockDragGhostOpacity = 0.45;
    private Border? _externalImageDragGhostBorder;
    private static readonly HttpClient ExternalImageHttpClient = new();

    /// <summary>Notes editor: scroll <see cref="ScrollViewer"/> while reordering blocks near viewport top/bottom (same idea as sidebar <see cref="Mnemo.UI.Modules.Notes.Views.DragCoordinator"/>).</summary>
    private DispatcherTimer? _blockDragAutoScrollTimer;
    private double _blockDragAutoScrollDirection;
    private const double BlockDragAutoScrollZone = 40.0;
    private const double BlockDragAutoScrollStep = 9.0;
    private const int BlockDragAutoScrollIntervalMs = 50;
    private readonly record struct FindMatch(string BlockId, int Start, int Length);
    private readonly List<FindMatch> _findMatches = new();
    private int _activeFindMatchIndex = -1;
    private string _findQuery = string.Empty;
    private string _replaceQuery = string.Empty;
    internal bool _findPanelVisible;
    private bool _replacePanelExpanded;
    private IOverlayService? _overlayService;
    private string? _findOverlayId;
    private EditorFindPanel? _findPanel;
    private ScrollViewer? _findAnchorScrollHost;
    private EventHandler<SizeChangedEventArgs>? _findAnchorScrollSizeChangedHandler;
    private double? _lastFindOverlayAnchorX;
    private double? _lastFindOverlayAnchorY;
    private bool _isSyncingFindOptionToggles;
    private CaretState? _findCaretBeforeOpen;
    private bool _findNavigatedToMatch;

    /// <summary>Fixed width used for top-right anchor math so overlay position does not feed back into layout.</summary>
    private const double FindOverlayAnchorWidthEstimate = 332.0;

    // Cross-block text selection (Mode 1)
    internal bool _isCrossBlockSelecting;
    internal bool _crossBlockArmed;  // true after pointer-down inside TextBox, waiting for first move outside
    /// <summary>True while a cross-block text selection drag is actively in progress. Used by EditableBlock to suppress focus side-effects during the drag.</summary>
    public bool IsCrossBlockSelectingActive => _isCrossBlockSelecting;
    /// <summary>True while any pointer-driven selection mode is armed or active. EditableBlock uses this to suppress toolbar checks during drag, which eliminates O(N) scans on every pointer-move-induced selection-change notification.</summary>
    internal bool IsPointerSelecting => _isCrossBlockSelecting || _isBoxSelecting || _crossBlockArmed || _boxSelectArmed;
    private BlockViewModel? _crossBlockAnchorBlock;
    private int _crossBlockAnchorBlockIndex = -1;
    private int _crossBlockAnchorCharIndex;
    private Point _crossBlockStartPoint;
    /// <summary>Hysteresis: last endpoint block index to avoid boundary flicker when dragging across blocks.</summary>
    private int _lastCrossBlockCurrentIndex = -1;
    /// <summary>True while applying inline format to a cross-block selection; prevents focus changes from clearing other blocks' selection.</summary>
    internal bool _isApplyingCrossBlockFormat;

    // History / undo-redo
    private IHistoryManager? _history;
    internal BlockSnapshot[]? _pendingSnapshot;
    private CaretState? _pendingCaretBefore;
    internal bool _isRestoringFromHistory;

    // Text-edit batching (300ms idle flush)
    private DispatcherTimer? _typingBatchTimer;
    private string? _typingBatchBlockId;
    private List<InlineSpan>? _typingBatchRunsBefore;
    private CaretState? _typingBatchCaretBefore;
    private const int TypingBatchIdleMs = 300;

    /// <summary>Reference count of blocks with <see cref="BlockViewModel.IsSelected"/>=true. Lets <see cref="ClearBlockSelection"/> skip a full document walk on every keystroke when no blocks are selected.</summary>
    internal int _selectedBlockCount;

    /// <summary>
    /// Cached flat document-order list. Rebuilt lazily on first access after any structural change.
    /// Eliminates the repeated <c>EnumerateInDocumentOrder(Blocks).ToList()</c> allocation that
    /// previously happened on every pointer-move event during selection.
    /// </summary>
    internal List<BlockViewModel>? _cachedDocumentOrder;
    internal bool _documentOrderDirty = true;
    /// <summary>Reverse index (VM Ã¢â€ â€™ docIndex) built alongside <see cref="_cachedDocumentOrder"/>. Lets realized-block loops look up positions in O(1) instead of scanning the full list.</summary>
    internal Dictionary<BlockViewModel, int>? _cachedDocIndexByVm;

    /// <summary>Pending pointer position captured by <see cref="Editor_PointerMoved"/> but not yet processed. Allows coalescing rapid pointer events so only the latest position is acted on per render frame.</summary>
    private Point _pendingPointerPoint;
    /// <summary>True when a pending pointer-move update has been scheduled on the dispatcher but has not yet run.</summary>
    private bool _pendingPointerUpdateScheduled;
    /// <summary>Pending mode flags for the coalesced pointer update.</summary>
    private bool _pendingPointerIsBox;
    private bool _pendingPointerIsCross;

    /// <summary>
    /// O(1) VM Ã¢â€ â€™ realized <see cref="EditableBlock"/> map. <see cref="EditableBlock"/> registers in
    /// <c>OnControlLoaded</c> and unregisters in <c>OnControlUnloaded</c>. Replaces the
    /// <c>GetVisualDescendants</c> walks that made every focus change O(NÃ‚Â²) over 1500 blocks.
    /// </summary>
    internal readonly Dictionary<BlockViewModel, EditableBlock> _realizedBlocksByVm = new();

    /// <summary>Tracked set of blocks whose <see cref="BlockViewModel.Type"/> is <see cref="BlockType.NumberedList"/>.
    /// Maintained via subscribe/unsubscribe + Type-property notifications so <see cref="UpdateListNumbers"/> and
    /// <see cref="ReorderBlocks"/> can skip a full-document walk when there are no numbered lists.</summary>
    internal readonly HashSet<BlockViewModel> _numberedListBlocks = new(ReferenceEqualityComparer.Instance);

    /// <summary>
    /// Set by the owning view to enable document-wide undo/redo.
    /// Cleared on document switch so history does not leak between notes.
    /// </summary>
    public IHistoryManager? History
    {
        get => _history;
        set
        {
            if (ReferenceEquals(_history, value)) return;
            if (_history != null)
                _history.Cleared -= OnHistoryManagerCleared;
            _history = value;
            if (_history != null)
                _history.Cleared += OnHistoryManagerCleared;
        }
    }

    /// <summary>Optional: set from the host view for Mnemo JSON + markdown clipboard.</summary>
    public INoteClipboardPayloadCodec? NoteClipboardCodec { get; set; }

    /// <summary>Optional: set from the host view for multi-format clipboard I/O.</summary>
    public INoteClipboardPlatformService? NoteClipboardService { get; set; }

    /// <summary>Optional: image import when pasting paths / duplicating / hydrating clipboard blocks.</summary>
    public IImageAssetService? ImageAssetService { get; set; }

    /// <summary>Note id whose blocks are being edited; used when inserting a <see cref="BlockType.Page"/> block from the slash menu.</summary>
    public string? HostNoteId { get; set; }

    /// <summary>Resolve a note title by id for <see cref="BlockType.Page"/> button labels.</summary>
    public Func<string, string?>? NoteTitleResolver { get; set; }

    /// <summary>Count direct child notes (<see cref="Note.ParentNoteId"/>) for page block subtitle.</summary>
    public Func<string, int>? ChildPageCountResolver { get; set; }

    /// <summary>Creates a child note under <paramref name="parentNoteId"/>; returns the new note id.</summary>
    public Func<string, Task<string?>>? CreateChildPageUnderNoteAsync { get; set; }

    /// <summary>Optional: persist the current note from the editor immediately (e.g. after inserting a page block).</summary>
    public Func<Task>? FlushPendingNoteSaveAsync { get; set; }

    /// <summary>Fallback label when the referenced note is missing or empty.</summary>
    public string PageBlockMissingTitle { get; set; } = "Missing note";

    /// <summary>Raised when the user activates a page block; host should open <paramref name="noteId"/>.</summary>
    public event Action<string>? OpenReferencedNote;

    public void RequestOpenReferencedNote(string noteId)
    {
        if (string.IsNullOrWhiteSpace(noteId)) return;
        OpenReferencedNote?.Invoke(noteId.Trim());
    }

    /// <summary>Refreshes <see cref="BlockType.Page"/> button titles from <see cref="NoteTitleResolver"/>.</summary>
    public void RefreshPageBlockTitles()
    {
        var missing = PageBlockMissingTitle;
        foreach (var b in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
        {
            if (b.Type == BlockType.Page)
                b.RefreshPageButtonTitle(NoteTitleResolver, missing, ChildPageCountResolver);
        }
    }

    internal const string NativeTwoColumnMetaKey = "nativeTwoColumn";

    /// <summary>
    /// Stored image paths the user has replaced or removed from the document; safe to delete once
    /// <see cref="IHistoryManager"/> can no longer undo (see <see cref="IHistoryManager.Cleared"/>).
    /// Paths are removed when they appear again in the document (undo) via <see cref="ReconcileReleasedStoredImagePathsWithDocument"/>.
    /// </summary>
    private readonly HashSet<string> _releasedStoredImagePaths = new(StringComparer.OrdinalIgnoreCase);

    public static readonly StyledProperty<bool> IsReadOnlyProperty =
        AvaloniaProperty.Register<BlockEditor, bool>(nameof(IsReadOnly), defaultValue: false);

    /// <summary>
    /// When true, block-structural interactions are disabled (drag/drop, slash menu, block add/delete/reorder).
    /// Rich text selection stays available for copy scenarios.
    /// </summary>
    public bool IsReadOnly
    {
        get => GetValue(IsReadOnlyProperty);
        set => SetValue(IsReadOnlyProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == IsReadOnlyProperty)
        {
            foreach (var eb in this.GetVisualDescendants().OfType<EditableBlock>())
                eb.SyncReadOnlyChromeFromBlockEditor();
        }
    }

    // TopLevel handlers for global pointer tracking (needed to intercept moves even when TextBox has capture)
    private TopLevel? _topLevel;
    private EventHandler<PointerEventArgs>? _globalPointerMovedHandler;
    private EventHandler<PointerReleasedEventArgs>? _globalPointerReleasedHandler;

    public BlockEditor()
    {
        InitializeComponent();
        InitializeCoordinators();
        DataContext = this;
        DragDrop.SetAllowDrop(this, true);
        AddHandler(DragDrop.DragOverEvent, Editor_DragOver_BlockGhost, RoutingStrategies.Bubble, handledEventsToo: true);
        AddHandler(DragDrop.DropEvent, Editor_Drop, RoutingStrategies.Bubble, handledEventsToo: true);
        AddHandler(DragDrop.DragLeaveEvent, Editor_DragLeave, RoutingStrategies.Bubble, handledEventsToo: true);
        AddHandler(PointerPressedEvent, Editor_PointerPressedTunnel, RoutingStrategies.Tunnel);
        AddHandler(PointerPressedEvent, Editor_PointerPressedBubble, RoutingStrategies.Bubble, handledEventsToo: true);
        // When we capture the pointer (cross-block or box-select), we receive moves/releases on this control
        AddHandler(PointerMovedEvent, Editor_PointerMoved, RoutingStrategies.Tunnel);
        AddHandler(PointerReleasedEvent, Editor_PointerReleased, RoutingStrategies.Tunnel);
        // Tunnel so we get keys before the focused TextBox (for block-selection Backspace/Copy/Paste)
        AddHandler(KeyDownEvent, Editor_KeyDown, RoutingStrategies.Tunnel);
        AddHandler(KeyDownEvent, Editor_KeyDown_Bubble, RoutingStrategies.Bubble);
        Loaded += Editor_Loaded;
        Unloaded += Editor_Unloaded;
        _overlayService = ((App?)Application.Current)?.Services?.GetService<IOverlayService>();

        // Don't add initial block here - let LoadBlocks handle it
    }

    private void Editor_Loaded(object? sender, RoutedEventArgs e)
    {
        ResolveSelectionBoxBorder();
        SetupBlockRowHeightVirtualization();
        RefreshAllRowLayoutHeightHints();

        // Register global pointer handlers on TopLevel so we receive moves/releases
        // even when a child TextBox has captured the pointer for its own text selection.
        _topLevel = TopLevel.GetTopLevel(this);
        if (_topLevel != null)
        {
            _globalPointerMovedHandler = Editor_PointerMoved;
            _globalPointerReleasedHandler = Editor_PointerReleased;
            _topLevel.AddHandler(PointerMovedEvent, _globalPointerMovedHandler, RoutingStrategies.Tunnel);
            _topLevel.AddHandler(PointerReleasedEvent, _globalPointerReleasedHandler, RoutingStrategies.Tunnel);
        }
    }

    private void Editor_Unloaded(object? sender, RoutedEventArgs e)
    {
        TeardownBlockRowHeightVirtualization();
        CloseFindPanel(clearQuery: false);

        if (_topLevel != null)
        {
            if (_globalPointerMovedHandler != null)
                _topLevel.RemoveHandler(PointerMovedEvent, _globalPointerMovedHandler);
            if (_globalPointerReleasedHandler != null)
                _topLevel.RemoveHandler(PointerReleasedEvent, _globalPointerReleasedHandler);
            _globalPointerMovedHandler = null;
            _globalPointerReleasedHandler = null;
            _topLevel = null;
        }

        if (_history != null)
            _history.Cleared -= OnHistoryManagerCleared;

        EndBlockDragGhost();
    }

    private void ResolveSelectionBoxBorder()
    {
        _selectionBoxBorder ??= this.FindControl<Border>("SelectionBoxBorder");
        if (_selectionBoxBorder == null)
        {
            var grid = this.FindControl<Grid>("EditorRoot");
            _selectionBoxBorder = grid?.GetVisualChildren().OfType<Border>().FirstOrDefault(c => c.Name == "SelectionBoxBorder");
        }
    }

    public void LoadBlocks(Block[] blocks)
    {
        var perf = EditorPerfDiagnostics.Resolve();
        using var loadScope = EditorPerfDiagnostics.Measure(perf, "loadBlocks", $"{blocks?.Length ?? 0} top-level");
        var phaseStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;

        void MarkPhase(string phase, string? detail = null)
        {
            if (perf is not { IsEnabled: true } || phaseStart == 0)
                return;

            var ms = EditorPerfDiagnostics.ElapsedMs(phaseStart);
            perf.RecordTiming("NotesEditor", $"loadBlocks.{phase}", ms, detail);
            phaseStart = Stopwatch.GetTimestamp();
        }

        var subStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        FlushTypingBatch();
        EditorPerfDiagnostics.RecordPhase(perf, subStart, "loadBlocks.reset.flushTypingBatch");

        subStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        _pendingSnapshot = null;
        _pendingCaretBefore = null;
        _history?.Clear();
        EditorPerfDiagnostics.RecordPhase(perf, subStart, "loadBlocks.reset.historyClear");

        _selectedBlockCount = 0;
        // Defensive reset: any cross-block / box-select state must not leak across notes.
        // Anchor VMs from the previous note will be unsubscribed below; leaving them set here
        // would let a stale pointer-move event poke a freed-up VM.
        _isCrossBlockSelecting = false;
        _crossBlockArmed = false;
        _crossBlockAnchorBlock = null;
        _crossBlockAnchorBlockIndex = -1;
        _lastCrossBlockCurrentIndex = -1;
        _isBoxSelecting = false;
        _boxSelectArmed = false;
        _pendingPointerUpdateScheduled = false;
        MarkPhase("reset");

        // Cache may hold entries for VMs from the previous document. Container Unloaded /
        // OnDataContextChanged eventually evicts them, but the timing isn't guaranteed before
        // the new document's first lookup, so wipe up front.
        _realizedBlocksByVm.Clear();
        _numberedListBlocks.Clear();

        // Unsubscribe from old blocks (do not register released paths; note switch / persistence owns asset lifetime).
        foreach (var block in Blocks)
            UnsubscribeFromBlock(block, registerReleasedStoredImagePath: false);
        Collection.ResetSubscriptionTracking();
        MarkPhase("unsubscribeOld", $"{Blocks.Count} previous top-level");

        // Create new collection to ensure proper UI notification
        var newBlocks = new ObservableCollection<BlockViewModel>();
        
        if (blocks == null || blocks.Length == 0)
        {
            var defaultBlock = BlockFactory.CreateBlock(BlockType.Text, 0);
            SubscribeToBlock(defaultBlock);
            newBlocks.Add(defaultBlock);
            MarkPhase("buildDefault");
        }
        else
        {
            var expanded = ColumnPairHelper.ExpandLegacyTwoColumnBlocks(blocks.Where(b => b != null));
            var seenIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var block in expanded.OrderBy(b => b.Order))
            {
                if (!string.IsNullOrEmpty(block.Id) && !seenIds.Add(block.Id))
                    continue;

                BlockViewModel viewModel;
                if (ColumnPairHelper.IsNestedTwoColumnBlock(block))
                {
                    var tc = new TwoColumnBlockViewModel(block);
                    SubscribeToBlock(tc);
                    viewModel = tc;
                }
                else
                {
                    viewModel = new BlockViewModel(block);
                    SubscribeToBlock(viewModel);
                }
                newBlocks.Add(viewModel);
            }

            ColumnPairHelper.MergeConsecutiveColumnPairs(newBlocks);
            MarkPhase("buildViewModels", $"{newBlocks.Count} top-level rows");
            
            // If no valid blocks were added, add a default one
            if (newBlocks.Count == 0)
            {
                var defaultBlock = BlockFactory.CreateBlock(BlockType.Text, 0);
                SubscribeToBlock(defaultBlock);
                newBlocks.Add(defaultBlock);
            }
        }
        
        // Replace entire collection to trigger UI update
        _focusedBlockIndex = -1;
        _focusedBlockId = null;
        Blocks = newBlocks;
        MarkPhase("assignBlocks", $"{newBlocks.Count} top-level");
        
        // Update list numbers after loading
        UpdateListNumbers();
        MarkPhase("updateListNumbers");

        RefreshPageBlockTitles();
        MarkPhase("refreshPageTitles");

        ReconcileReleasedStoredImagePathsWithDocument();
        MarkPhase("reconcileImages");

        // Focus the first block after UI updates to make it immediately editable
        if (newBlocks.Count > 0)
        {
            Avalonia.Threading.Dispatcher.UIThread.Post(
                () => newBlocks[0].IsFocused = true, 
                Avalonia.Threading.DispatcherPriority.Loaded);
        }
        MarkPhase("postFocus");
    }

    public Block[] GetBlocks()
    {
        var perf = EditorPerfDiagnostics.Resolve();
        using var scope = EditorPerfDiagnostics.Measure(perf, "getBlocks", $"{Blocks.Count} top-level");

        // Update order before returning
        for (int i = 0; i < Blocks.Count; i++)
        {
            Blocks[i].Order = i;
        }

        return Blocks.Select(b => b.ToBlock()).ToArray();
    }

    public void NotifyBlocksChanged()
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;

        if (_findPanelVisible)
        {
            var findStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
            RefreshFindMatchesAndHighlights();
            EditorPerfDiagnostics.RecordPhase(perf, findStart, "notifyBlocksChanged.findRefresh");
        }

        var titlesStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        RefreshPageBlockTitles();
        EditorPerfDiagnostics.RecordPhase(perf, titlesStart, "notifyBlocksChanged.pageTitles");

        var notifyStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        BlocksChanged?.Invoke();
        EditorPerfDiagnostics.RecordPhase(perf, notifyStart, "notifyBlocksChanged.blocksChanged");

        EditorPerfDiagnostics.RecordIfSlow(
            perf,
            "notifyBlocksChanged",
            EditorPerfDiagnostics.ElapsedMs(perfStart),
            $"top={Blocks.Count} realized={RealizedRowCount}");
    }

    public event System.Action? BlocksChanged;
    public new event PropertyChangedEventHandler? PropertyChanged;


    protected virtual void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}


