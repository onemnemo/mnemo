using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;
using Avalonia.Threading;
using Mnemo.Core.Models;
using Mnemo.UI.Components.BlockEditor.History;

namespace Mnemo.UI.Components.BlockEditor;

public partial class BlockEditor
{
    #region History helpers

    private static string Truncate(string? s, int max = 40) =>
        s == null ? "<null>" : s.Length <= max ? $"'{s}'" : $"'{s[..max]}…'";

    private BlockSnapshot[] CaptureSnapshot()
    {
        var snapshots = new BlockSnapshot[Blocks.Count];
        for (int i = 0; i < Blocks.Count; i++)
            snapshots[i] = BlockSnapshot.From(Blocks[i].ToBlock());
        return snapshots;
    }

    private CaretState? CaptureCaretState()
    {
        var focused = BlockHierarchy.FindFocused(Blocks);
        if (focused != null)
            return CaptureCaretStateForBlock(focused);

        // Context menus (spellcheck suggestions, etc.) can temporarily move keyboard focus
        // away from the editor while still editing the last focused block.
        if (!string.IsNullOrEmpty(_focusedBlockId))
        {
            var lastFocused = BlockHierarchy.FindById(Blocks, _focusedBlockId);
            if (lastFocused != null)
                return CaptureCaretStateForBlock(lastFocused);
        }

        return null;
    }

    private CaretState CaptureCaretStateForBlock(BlockViewModel block, int fallbackPosition = 0)
    {
        var editableBlock = GetEditableBlockForViewModel(block);
        var max = Math.Max(0, block.Content?.Length ?? 0);
        var caretPos = Math.Clamp(editableBlock?.GetCaretIndex() ?? fallbackPosition, 0, max);
        return new CaretState { BlockId = block.Id, CaretPosition = caretPos };
    }

    /// <summary>
    /// Call before any structural mutation (insert/delete/merge/move/type-change/paste).
    /// Captures a snapshot of the current document state for undo.
    /// If a previous snapshot was never committed (orphaned), it is discarded.
    /// </summary>
    internal void BeginStructuralChange()
    {
        if (_history == null || _isRestoringFromHistory) return;
        FlushTypingBatch();
        if (_pendingSnapshot == null)
            _pendingSnapshot = CaptureSnapshot();
        _pendingCaretBefore = CaptureCaretState();
    }

    /// <summary>
    /// Call after a structural mutation has completed. Pushes a DocumentOperation onto the undo stack.
    /// </summary>
    internal void CommitStructuralChange(string description)
    {
        if (_history == null || _isRestoringFromHistory || _pendingSnapshot == null) return;

        var after = CaptureSnapshot();
        var caretAfter = CaptureCaretState();
        var before = _pendingSnapshot;
        var caretBefore = _pendingCaretBefore;
        _pendingSnapshot = null;
        _pendingCaretBefore = null;


        var op = new DocumentOperation(description, before, after, caretBefore, caretAfter, RestoreDocument);
        _history.Push(op);
    }

    /// <summary>
    /// Callback used by DocumentOperation to restore the editor to a previous state.
    /// Updates blocks in-place where possible to avoid a full UI rebuild.
    /// </summary>
    private void RestoreDocument(Block[] blocks, CaretState? caret)
    {
        _isRestoringFromHistory = true;
        try
        {
            var targetBlocks = blocks ?? Array.Empty<Block>();
            var flattened = ColumnPairHelper.ExpandLegacyTwoColumnBlocks(targetBlocks.OrderBy(b => b.Order));
            var existingById = new Dictionary<string, BlockViewModel>();
            foreach (var b in Blocks)
                existingById[b.Id] = b;

            var newList = new List<BlockViewModel>(flattened.Count);
            var usedIds = new HashSet<string>();

            foreach (var blk in flattened)
            {
                if (ColumnPairHelper.IsNestedTwoColumnBlock(blk))
                {
                    var tvm = new TwoColumnBlockViewModel(blk);
                    SubscribeToBlock(tvm);
                    newList.Add(tvm);
                    continue;
                }

                if (existingById.TryGetValue(blk.Id, out var existing) && usedIds.Add(blk.Id))
                {
                    blk.EnsureSpans();
                    existing.SetSpans(blk.Spans);
                    existing.Type = blk.Type;
                    existing.ApplyPayloadFromHistorySnapshot(blk);
                    existing.Meta = new Dictionary<string, object>(blk.Meta ?? new Dictionary<string, object>());
                    existing.Order = blk.Order;
                    newList.Add(existing);
                }
                else
                {
                    var vm = new BlockViewModel(blk);
                    SubscribeToBlock(vm);
                    newList.Add(vm);
                }
            }

            var mergeWork = new ObservableCollection<BlockViewModel>(newList);
            ColumnPairHelper.MergeConsecutiveColumnPairs(mergeWork);
            newList = mergeWork.ToList();

            // Unsubscribe from blocks that are no longer present
            foreach (var kvp in existingById)
            {
                if (!usedIds.Contains(kvp.Key))
                    UnsubscribeFromBlock(kvp.Value, registerReleasedStoredImagePath: false);
            }

            // Ensure at least one block
            if (newList.Count == 0)
            {
                var defaultBlock = BlockFactory.CreateBlock(BlockType.Text, 0);
                SubscribeToBlock(defaultBlock);
                newList.Add(defaultBlock);
            }

            // Sync ObservableCollection in-place: remove extras, reorder, insert new
            for (int i = 0; i < newList.Count; i++)
            {
                if (i < Blocks.Count)
                {
                    if (!ReferenceEquals(Blocks[i], newList[i]))
                    {
                        var existIdx = Blocks.IndexOf(newList[i]);
                        if (existIdx >= 0)
                            Blocks.Move(existIdx, i);
                        else
                            Blocks.Insert(i, newList[i]);
                    }
                }
                else
                {
                    Blocks.Add(newList[i]);
                }
            }
            while (Blocks.Count > newList.Count)
                Blocks.RemoveAt(Blocks.Count - 1);

            _focusedBlockIndex = -1;
            UpdateListNumbers();
            RefreshPageBlockTitles();

            ApplyCaretFocus(caret);
            ReconcileReleasedStoredImagePathsWithDocument();
            BlocksChanged?.Invoke();
        }
        finally
        {
            // Defer clearing the flag so any TextChanged events fired by async
            // binding propagation still see _isRestoringFromHistory = true.
            Dispatcher.UIThread.Post(() => _isRestoringFromHistory = false, DispatcherPriority.Render);
        }
    }

    /// <summary>
    /// Callback used by TextEditOperation to restore a single block's runs.
    /// </summary>
    private void RestoreBlockRuns(string blockId, List<InlineSpan> runs, CaretState? caret)
    {
        _isRestoringFromHistory = true;
        try
        {
            var vm = BlockHierarchy.FindById(Blocks, blockId);
            if (vm != null)
            {
                vm.SetSpans(runs);
            }
            else
            {
            }

            ApplyCaretFocus(caret);
            BlocksChanged?.Invoke();
        }
        finally
        {
            Dispatcher.UIThread.Post(() => _isRestoringFromHistory = false, DispatcherPriority.Render);
        }
    }

    private void ApplyCaretFocus(CaretState? caret)
    {
        if (caret == null || string.IsNullOrEmpty(caret.BlockId)) return;

        foreach (var b in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
            b.IsFocused = false;

        var caretPos = caret.CaretPosition;
        var target = BlockHierarchy.FindById(Blocks, caret.BlockId);
        if (target == null) return;
        target.PendingCaretIndex = caretPos;

        Dispatcher.UIThread.Post(() =>
        {
            var latestTarget = BlockHierarchy.FindById(Blocks, caret.BlockId);
            if (latestTarget == null) return;
            latestTarget.PendingCaretIndex = caretPos;
            latestTarget.IsFocused = true;
        }, DispatcherPriority.Input);
    }

    #endregion

    #region Typing batch (300ms idle -> commit)

    /// <summary>
    /// Called by OnBlockContentChanged to start/extend a typing batch for the given block.
    /// <paramref name="previousText"/> is the text *before* this edit (from EditorStateManager).
    /// Must not be null; caller must have a valid pre-edit snapshot.
    /// </summary>
    internal void TrackTypingEdit(BlockViewModel block, string previousText, List<InlineSpan>? previousRuns = null)
    {
        if (_history == null || _isRestoringFromHistory)
        {
            return;
        }

        if (_typingBatchBlockId != null && _typingBatchBlockId != block.Id)
        {
            FlushTypingBatch();
        }

        if (_typingBatchBlockId == null)
        {
            _typingBatchBlockId = block.Id;
            
            if (previousRuns != null)
            {
                _typingBatchRunsBefore = previousRuns;
            }
            else
            {
                _typingBatchRunsBefore = block.CloneSpans();
                // Reconstruct the runs as they were *before* this edit using the previous text
                if (previousText != block.Content)
                {
                    _typingBatchRunsBefore = Core.Formatting.InlineSpanFormatApplier.ApplyTextEdit(
                        _typingBatchRunsBefore, block.Content, previousText);
                }
            }
            _typingBatchCaretBefore = CaptureCaretState()
                ?? CaptureCaretStateForBlock(block);
        }

        _typingBatchTimer?.Stop();
        _typingBatchTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(TypingBatchIdleMs) };
        _typingBatchTimer.Tick += OnTypingBatchIdle;
        _typingBatchTimer.Start();
    }

    private void OnTypingBatchIdle(object? sender, EventArgs e)
    {
        FlushTypingBatch();
    }

    /// <summary>
    /// Flush the active typing batch into a TextEditOperation. Called on idle, Enter,
    /// merge, paste, block switch, and note switch.
    /// </summary>
    public void FlushTypingBatch()
    {
        _typingBatchTimer?.Stop();
        if (_typingBatchTimer != null)
        {
            _typingBatchTimer.Tick -= OnTypingBatchIdle;
            _typingBatchTimer = null;
        }

        if (_history == null || _typingBatchBlockId == null) return;

        var vm = BlockHierarchy.FindById(Blocks, _typingBatchBlockId);
        if (vm == null)
        {
            _typingBatchBlockId = null;
            _typingBatchRunsBefore = null;
            _typingBatchCaretBefore = null;
            return;
        }

        var runsAfter = vm.CloneSpans();
        var runsBefore = _typingBatchRunsBefore ?? new List<InlineSpan> { InlineSpan.Plain(string.Empty) };

        bool runsEqual = runsBefore.Count == runsAfter.Count && runsBefore.SequenceEqual(runsAfter);

        if (runsEqual)
        {
            _typingBatchBlockId = null;
            _typingBatchRunsBefore = null;
            _typingBatchCaretBefore = null;
            return;
        }

        var textBefore = Core.Formatting.InlineSpanFormatApplier.Flatten(runsBefore);
        var textAfter = vm.Content ?? string.Empty;

        var caretAfter = CaptureCaretStateForBlock(vm);


        var op = new TextEditOperation(
            "Typing",
            vm.Id,
            runsBefore,
            runsAfter,
            _typingBatchCaretBefore,
            caretAfter,
            RestoreBlockRuns);

        _history.Push(op);

        _typingBatchBlockId = null;
        _typingBatchRunsBefore = null;
        _typingBatchCaretBefore = null;
    }

    public async Task UndoAsync()
    {
        if (_history == null || !_history.CanUndo)
        {
            return;
        }
        FlushTypingBatch();
        await _history.UndoAsync();
    }

    public async Task RedoAsync()
    {
        if (_history == null || !_history.CanRedo)
        {
            return;
        }
        await _history.RedoAsync();
    }

    #endregion
}
