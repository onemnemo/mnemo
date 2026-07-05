using System;
using System.Collections.Generic;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.UI.Components.Overlays.Transfer;

/// <summary>
/// Which transfer directions the caller allows. With <see cref="Both"/> the dialog
/// shows an Import / Export switch in the header; single-direction contexts show
/// a direction icon instead.
/// </summary>
public enum TransferDialogDirection
{
    ImportOnly,
    ExportOnly,
    Both
}

/// <summary>
/// One selectable export format, rendered as a radio card.
/// </summary>
public sealed class TransferExportFormatOption
{
    /// <summary>Adapter format id (e.g. "notes.markdown"), or a caller-defined id for synthetic formats the caller handles itself.</summary>
    public required string FormatId { get; init; }

    /// <summary>Mono extension label shown on the card, e.g. ".md".</summary>
    public required string ExtensionLabel { get; init; }

    /// <summary>Human name, e.g. "Markdown".</summary>
    public required string DisplayName { get; init; }

    /// <summary>Short localized caption, e.g. "Portable, keeps structure".</summary>
    public string? Caption { get; init; }

    /// <summary>File extensions used for the save picker, e.g. [".md"].</summary>
    public required IReadOnlyList<string> Extensions { get; init; }

    /// <summary>Scope ids this format supports; null means all scopes.</summary>
    public IReadOnlyList<string>? ScopeIds { get; init; }
}

/// <summary>
/// One selectable export scope ("This note", "All notes", ...), rendered as a segment.
/// </summary>
public sealed class TransferExportScopeOption
{
    public required string ScopeId { get; init; }

    /// <summary>Localized segment label.</summary>
    public required string Label { get; init; }

    /// <summary>Optional item count shown next to the label.</summary>
    public int? Count { get; init; }

    public bool IsEnabled { get; init; } = true;
}

/// <summary>
/// A file queued for import, with its auto-detected format.
/// </summary>
public sealed partial class TransferImportFile : ObservableObject
{
    public required string FilePath { get; init; }

    public required string FileName { get; init; }

    public long SizeBytes { get; init; }

    /// <summary>Detected adapter format id; null while detection is pending.</summary>
    [ObservableProperty]
    private string? _formatId;

    /// <summary>Number of items the file will produce, per import preview.</summary>
    [ObservableProperty]
    private int _itemCount;

    /// <summary>Secondary row line, e.g. "48 KB · Markdown · 1 note".</summary>
    [ObservableProperty]
    private string _detailLabel = string.Empty;
}

/// <summary>
/// Everything a caller provides to open the transfer dialog. Strings are passed
/// pre-localized so modules keep their own translation namespaces.
/// </summary>
public sealed class TransferDialogContext
{
    /// <summary>Adapter content type, e.g. "notes".</summary>
    public required string ContentType { get; init; }

    public TransferDialogDirection Direction { get; init; } = TransferDialogDirection.Both;

    /// <summary>Which side is active initially when both directions are allowed.</summary>
    public bool StartWithImport { get; init; } = true;

    public required string ImportTitle { get; init; }

    public string? ExportTitle { get; init; }

    /// <summary>Localized destination line under the import title, e.g. "Into Developer".</summary>
    public string? ImportSubtitle { get; init; }

    /// <summary>Localized source line under the export title, e.g. "From Developer / Anatomy".</summary>
    public string? ExportSubtitle { get; init; }

    /// <summary>Localized singular item noun, e.g. "note".</summary>
    public required string ItemNounSingular { get; init; }

    /// <summary>Localized plural item noun, e.g. "notes".</summary>
    public required string ItemNounPlural { get; init; }

    /// <summary>Localized conflict question, e.g. "If a note already exists". Null hides the conflict section.</summary>
    public string? ConflictQuestion { get; init; }

    /// <summary>Import capabilities for extension chips, the file picker filter, and format-name lookup.</summary>
    public IReadOnlyList<ImportExportCapability> ImportCapabilities { get; init; } = [];

    public IReadOnlyList<TransferExportFormatOption> ExportFormats { get; init; } = [];

    /// <summary>Export scopes; empty hides the scope section.</summary>
    public IReadOnlyList<TransferExportScopeOption> ExportScopes { get; init; } = [];

    /// <summary>Coordinator used to auto-detect the format of queued import files. Required when import is allowed.</summary>
    public IImportExportCoordinator? Coordinator { get; init; }

    public int MaxFiles { get; init; } = 5;

    /// <summary>Folder id imported items should land in, forwarded to the import request.</summary>
    public string? TargetFolderId { get; init; }
}

/// <summary>
/// What the user confirmed. Null result from the dialog means cancelled.
/// </summary>
public sealed class TransferDialogResult
{
    public required bool IsImport { get; init; }

    public IReadOnlyList<TransferImportFile> Files { get; init; } = [];

    public ImportConflictPolicy ConflictPolicy { get; init; } = ImportConflictPolicy.KeepBoth;

    public TransferExportFormatOption? Format { get; init; }

    public TransferExportScopeOption? Scope { get; init; }
}
