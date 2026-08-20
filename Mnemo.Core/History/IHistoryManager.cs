using System;
using System.Threading.Tasks;

namespace Mnemo.Core.History;

/// <summary>
/// Document-scoped undo/redo stack. One instance is used per active document
/// (note or mindmap). Cleared/swapped on document change.
/// </summary>
public interface IHistoryManager
{
    bool CanUndo { get; }
    bool CanRedo { get; }

    Task UndoAsync();
    Task RedoAsync();

    /// <summary>
    /// Push a single operation onto the undo stack. Clears the redo stack.
    /// The operation is assumed to have already been applied.
    /// </summary>
    void Push(IHistoryOperation operation);

    /// <summary>
    /// Open a batch. All operations pushed while a batch is open are grouped
    /// into a single composite undo entry. Batches must not nest.
    /// </summary>
    void BeginBatch(string description, OperationSource source);

    /// <summary>
    /// Commit the current batch as a single undo entry.
    /// No-op if no operations were pushed during the batch.
    /// </summary>
    void CommitBatch();

    /// <summary>
    /// Discard the current batch without adding it to the undo stack.
    /// </summary>
    void DiscardBatch();

    /// <summary>
    /// Whether a batch is currently open.
    /// </summary>
    bool IsBatching { get; }

    /// <summary>
    /// Clear all undo/redo history. Called on document switch.
    /// </summary>
    void Clear();

    /// <summary>
    /// Raised after <see cref="Clear"/> discards the stacks. Undo/redo can no longer restore
    /// prior document state. Hosts use this to reclaim resources (e.g. stored image files).
    /// </summary>
    event Action? Cleared;

    /// <summary>
    /// Raised after any push, undo, redo, or clear that changes CanUndo/CanRedo.
    /// </summary>
    event Action? StateChanged;
}
