using Avalonia;
using Avalonia.Controls;
using Avalonia.Input.Platform;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Common;
using Mnemo.UI.Services;

namespace Mnemo.UI.Components.BlockEditor;

public partial class BlockEditor
{
    private static readonly HashSet<string> ClipboardImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif"
    };

    private IImageAssetService? ResolveImageAssetService() =>
        ImageAssetService ?? (Application.Current as App)?.Services?.GetService(typeof(IImageAssetService)) as IImageAssetService;

    /// <summary>
    /// Last-block guard for clicking the area below all blocks: avoid stacking duplicate empty text blocks.
    /// Structural/non-text block types are never considered "empty" for this purpose because they don't
    /// hold flow text; the guard only prevents duplicate empty text blocks at the bottom of the document.
    /// </summary>
    private static bool IsLastBlockEmptyForBelowBlocksAreaClick(IReadOnlyList<BlockViewModel> blocks)
    {
        if (blocks.Count == 0) return false;

        // Check the top-level last block first. TwoColumnBlockViewModel is a structural container.
        // EnumerateInDocumentOrder skips it and returns its column children instead, which would cause
        // the empty-text check to incorrectly evaluate the last child (often an empty placeholder row).
        var topLast = blocks[blocks.Count - 1];
        if (IsStructuralBlockType(topLast.Type))
            return false;

        // For single-block rows, fall through to the per-type emptiness logic using document order
        // so that nested leaf blocks (e.g. the last block inside a two-column's right column) are
        // still reachable, but only when the top-level row is not itself structural.
        var last = BlockHierarchy.EnumerateInDocumentOrder(blocks).LastOrDefault() ?? topLast;

        switch (last.Type)
        {
            case BlockType.Image:
                // An image block with a path or caption is not empty.
                if (!string.IsNullOrWhiteSpace(last.ImagePath)) return false;
                if (!string.IsNullOrWhiteSpace(last.Content)) return false;
                return true;

            // These types carry identity in payload/ReferenceNoteId, not in Content.
            case BlockType.Page:
            case BlockType.Sketch:
            case BlockType.Divider:
                return false;
        }

        return BlockEditorContentPolicy.IsVisuallyEmpty(last.Content);
    }

    /// <summary>Returns true for block types that are structural containers or inherently non-empty
    /// by design, meaning they should never block new-block insertion regardless of their content state.</summary>
    private static bool IsStructuralBlockType(BlockType type) => type is
        BlockType.TwoColumn or
        BlockType.ColumnGroup or
        BlockType.Page or
        BlockType.Sketch or
        BlockType.Divider;

    private static string GetBlockMetaString(BlockViewModel vm, string key)
    {
        if (!vm.Meta.TryGetValue(key, out var val) || val == null) return string.Empty;
        if (val is string s) return s;
        if (val is JsonElement je && je.ValueKind == JsonValueKind.String) return je.GetString() ?? string.Empty;
        return val.ToString() ?? string.Empty;
    }

    private static double GetBlockMetaDouble(BlockViewModel vm, string key)
    {
        if (!vm.Meta.TryGetValue(key, out var val)) return 0;
        if (val is double d) return d;
        if (val is JsonElement je && je.ValueKind == JsonValueKind.Number) return je.GetDouble();
        if (double.TryParse(val?.ToString(), out var p)) return p;
        return 0;
    }

    /// <summary>
    /// Marks a path under the app images directory as no longer shown in the document (e.g. image replaced).
    /// </summary>
    public void RegisterReleasedStoredImagePath(string? path)
    {
        if (!Dispatcher.UIThread.CheckAccess())
        {
            Dispatcher.UIThread.Post(() => RegisterReleasedStoredImagePath(path));
            return;
        }

        RegisterReleasedStoredImagePathCore(path);
    }

    internal void RegisterReleasedStoredImagePathCore(string? path)
    {
        var n = NormalizePathForImageCompare(path);
        if (n == null || !MnemoAppPaths.IsPathUnderImagesDirectory(n)) return;
        _releasedStoredImagePaths.Add(n);
    }

    private void ReconcileReleasedStoredImagePathsWithDocument()
    {
        var referenced = CollectReferencedStoredImagePathsNormalized();
        _releasedStoredImagePaths.RemoveWhere(referenced.Contains);
    }

    private static string? NormalizePathForImageCompare(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        try
        {
            return Path.GetFullPath(path);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// After <see cref="IHistoryManager.Clear"/>, undo cannot restore prior edits; delete stored image files
    /// that were explicitly released during this session and are still not referenced by the document.
    /// </summary>
    private void OnHistoryManagerCleared()
    {
        if (!Dispatcher.UIThread.CheckAccess())
        {
            Dispatcher.UIThread.Post(OnHistoryManagerCleared, DispatcherPriority.Normal);
            return;
        }

        var referenced = CollectReferencedStoredImagePathsNormalized();
        _ = DeleteReleasedStoredImagesAfterHistoryClearedAsync(referenced);
    }

    private HashSet<string> CollectReferencedStoredImagePathsNormalized()
    {
        var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var b in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
        {
            if (b.Type != BlockType.Image) continue;
            var n = NormalizePathForImageCompare(b.ImagePath);
            if (n != null)
                referenced.Add(n);
        }

        return referenced;
    }

    private async Task DeleteReleasedStoredImagesAfterHistoryClearedAsync(HashSet<string> referencedNormalizedPaths)
    {
        var svc = ResolveImageAssetService();
        if (svc == null) return;

        foreach (var path in _releasedStoredImagePaths.ToArray())
        {
            if (referencedNormalizedPaths.Contains(path))
                continue;
            try
            {
                await svc.DeleteStoredFileAsync(path, default).ConfigureAwait(false);
                _releasedStoredImagePaths.Remove(path);
            }
            catch
            {
            }
        }
    }

    private async Task HydratePastedImageBlocksAsync(BlockViewModel[] pasted)
    {
        var svc = ResolveImageAssetService();
        if (svc == null) return;
        foreach (var vm in pasted)
        {
            if (vm.Type != BlockType.Image) continue;
            var path = vm.ImagePath;
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) continue;
            var fileName = Path.GetFileNameWithoutExtension(path);
            if (string.Equals(fileName, vm.Id, StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                var r = await svc.ImportAndCopyAsync(path, vm.Id).ConfigureAwait(true);
                if (r.IsSuccess && !string.IsNullOrEmpty(r.Value))
                    vm.ImagePath = r.Value!;
            }
            catch
            {
            }
        }
    }

    private async Task<BlockViewModel[]?> TryPasteImageBlocksFromSystemClipboardAsync(IClipboard clipboard, string? textHint)
    {
        try
        {
            var files = await clipboard.TryGetFilesAsync().ConfigureAwait(true);
            if (files != null)
            {
                foreach (var f in files)
                {
                    var p = f.TryGetLocalPath();
                    if (string.IsNullOrEmpty(p) || !File.Exists(p)) continue;
                    if (!ClipboardImageExtensions.Contains(Path.GetExtension(p))) continue;
                    return new[] { CreateImageBlockStubForPaste(p) };
                }
            }
        }
        catch
        {
        }

        var bmp = await clipboard.TryGetBitmapAsync().ConfigureAwait(true);
        if (bmp != null)
        {
            try
            {
                return new[] { await SaveClipboardBitmapToNewImageBlockAsync(bmp).ConfigureAwait(true) };
            }
            finally
            {
                bmp.Dispose();
            }
        }

        var pathFromText = NormalizeSingleLineImagePathFromClipboard(textHint);
        if (pathFromText != null && File.Exists(pathFromText) &&
            ClipboardImageExtensions.Contains(Path.GetExtension(pathFromText)))
            return new[] { CreateImageBlockStubForPaste(pathFromText) };

        return null;
    }

    private static BlockViewModel CreateImageBlockStubForPaste(string pathOrExternal)
    {
        var vm = BlockFactory.CreateBlock(BlockType.Image, 0);
        vm.ImagePath = pathOrExternal;
        vm.ImageWidth = 0;
        vm.SetSpans(new List<InlineSpan> { InlineSpan.Plain(string.Empty) });
        return vm;
    }

    private static Task<BlockViewModel> SaveClipboardBitmapToNewImageBlockAsync(Bitmap source)
    {
        var vm = BlockFactory.CreateBlock(BlockType.Image, 0);
        var dir = MnemoAppPaths.GetImagesDirectory();
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, vm.Id + ".png");
        source.Save(path);
        vm.ImagePath = path;
        vm.ImageWidth = 0;
        vm.SetSpans(new List<InlineSpan> { InlineSpan.Plain(string.Empty) });
        return Task.FromResult(vm);
    }

    private static string? NormalizeSingleLineImagePathFromClipboard(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var t = text.Trim();
        if (t.IndexOf('\r') >= 0 || t.IndexOf('\n') >= 0) return null;
        if (t.Length >= 2 &&
            ((t[0] == '"' && t[^1] == '"') || (t[0] == '\'' && t[^1] == '\'')))
            t = t[1..^1].Trim();
        return string.IsNullOrWhiteSpace(t) ? null : t;
    }

    /// <summary>Top-level <see cref="Blocks"/> index for the row that contains the focused leaf block.</summary>
    private int GetFocusedBlockIndex()
    {
        if (_focusedBlockIndex >= 0 && _focusedBlockIndex < Blocks.Count)
        {
            var row = Blocks[_focusedBlockIndex];
            if (row.IsFocused)
                return _focusedBlockIndex;
            if (row is TwoColumnBlockViewModel tc
                && (tc.LeftColumnBlocks.Any(b => b.IsFocused) || tc.RightColumnBlocks.Any(b => b.IsFocused)))
                return _focusedBlockIndex;
        }

        var focused = BlockHierarchy.FindFocused(Blocks);
        if (focused != null)
        {
            var top = BlockHierarchy.GetTopLevelIndex(Blocks, focused);
            if (top >= 0)
            {
                _focusedBlockIndex = top;
                return top;
            }
        }
        _focusedBlockIndex = -1;
        return -1;
    }
}
