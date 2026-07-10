using System;
using System.IO;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>
/// Flat exports of the whole map (PNG raster, SVG vector) from the render layer. The bitmap is produced on
/// the UI thread (an Avalonia requirement) and only its encoding/writing runs off it; the SVG string is
/// built and written entirely off the UI thread.
/// </summary>
public partial class MindmapView
{
    // Whitespace around the content, and the largest bitmap edge before the PNG is uniformly downscaled.
    private const double ExportMargin = 48;
    private const double ExportMaxDimension = 8000;

    private async void OnExportPngClick(object? sender, RoutedEventArgs e) =>
        await ExportPngAsync().ConfigureAwait(true);

    private async void OnExportSvgClick(object? sender, RoutedEventArgs e) =>
        await ExportSvgAsync().ConfigureAwait(true);

    private async void OnExportMdClick(object? sender, RoutedEventArgs e) =>
        await ExportMarkdownAsync().ConfigureAwait(true);

    private async Task ExportPngAsync()
    {
        if (Vm is null || _canvas is null || Vm.Nodes.Count == 0)
            return;

        var file = await PickExportFileAsync("png", "PNG", "*.png").ConfigureAwait(true);
        if (file is null)
            return;

        try
        {
            var background = this.FindResource("WorkspaceBackgroundBrush") as IBrush ?? Brushes.White;
            using var bitmap = _canvas.RenderFullMap(background, ExportMargin, ExportMaxDimension);
            if (bitmap is null)
                return;

            var path = file.Path.LocalPath;
            await Task.Run(() => bitmap.Save(path)).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            await ReportExportFailureAsync(ex).ConfigureAwait(true);
        }
    }

    private async Task ExportSvgAsync()
    {
        if (Vm is null || _canvas is null || Vm.Nodes.Count == 0)
            return;

        var file = await PickExportFileAsync("svg", "SVG", "*.svg").ConfigureAwait(true);
        if (file is null)
            return;

        try
        {
            var backgroundHex = ResolveHexResource("WorkspaceBackgroundBrush", "#FFFFFF");
            // Color resolution touches theme resources, so it must stay on the UI thread; the rest does not.
            var scene = _canvas.BuildSvgScene(backgroundHex, ExportMargin);
            var path = file.Path.LocalPath;
            var svg = await Task.Run(() => MindmapSvgExporter.Emit(scene)).ConfigureAwait(true);
            await File.WriteAllTextAsync(path, svg).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            await ReportExportFailureAsync(ex).ConfigureAwait(true);
        }
    }

    // The Markdown outline is a pure projection of the in-memory document, built off the UI thread then written.
    private async Task ExportMarkdownAsync()
    {
        var document = Vm?.Document;
        if (Vm is null || Vm.Nodes.Count == 0 || document is null)
            return;

        var file = await PickExportFileAsync("md", "Markdown", "*.md").ConfigureAwait(true);
        if (file is null)
            return;

        try
        {
            var path = file.Path.LocalPath;
            var markdown = await Task.Run(() => MindmapMarkdownExporter.ExportOutline(document)).ConfigureAwait(true);
            await File.WriteAllTextAsync(path, markdown).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            await ReportExportFailureAsync(ex).ConfigureAwait(true);
        }
    }

    private async Task<IStorageFile?> PickExportFileAsync(string extension, string typeName, string pattern)
    {
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel?.StorageProvider is null || Vm is null)
            return null;

        return await topLevel.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = Tr("ExportTip", "Export"),
            SuggestedFileName = $"{SanitizeFileName(Vm.Title)}.{extension}",
            DefaultExtension = extension,
            FileTypeChoices = new[] { new FilePickerFileType(typeName) { Patterns = new[] { pattern } } },
        }).ConfigureAwait(true);
    }

    private async Task ReportExportFailureAsync(Exception ex)
    {
        var services = (Application.Current as App)?.Services;
        services?.GetService<ILoggerService>()?.Error("Mindmap", "Mindmap export failed", ex);

        var overlay = services?.GetService<IOverlayService>();
        if (overlay is null)
            return;
        await overlay.CreateDialogAsync(
            Tr("ExportFailedTitle", "Export failed"),
            Tr("ExportFailed", "The export could not be completed.")).ConfigureAwait(true);
    }

    private string ResolveHexResource(string key, string fallback)
    {
        if (this.TryFindResource(key, out var value) && value is ISolidColorBrush brush)
        {
            var c = brush.Color;
            return $"#{c.R:X2}{c.G:X2}{c.B:X2}";
        }
        return fallback;
    }

    private string Tr(string key, string fallback)
    {
        var localization = (Application.Current as App)?.Services?.GetService<ILocalizationService>();
        var value = localization?.T(key, "Mindmap");
        return string.IsNullOrEmpty(value) || value == key ? fallback : value;
    }

    private static string SanitizeFileName(string? value)
    {
        var name = string.IsNullOrWhiteSpace(value) ? "mindmap" : value.Trim();
        foreach (var invalid in Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');
        return name;
    }
}
