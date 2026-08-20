using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.UI.Components.Overlays;

namespace Mnemo.UI.Services;

public class OverlayService : IOverlayService
{
    public ObservableCollection<OverlayInstance> Overlays { get; } = new();
    private readonly Dictionary<string, TaskCompletionSource<object?>> _completionSources = new();
    private readonly Dictionary<string, Type> _typeCache = new();
    private readonly IPerfDiagnostics _perf;

    public OverlayService(IPerfDiagnostics perf)
    {
        _perf = perf;
    }

    public void Show(string overlayName, object? parameter = null)
    {
        using var scope = _perf.Measure("Overlay", "Show", overlayName);
        if (!_typeCache.TryGetValue(overlayName, out var type))
        {
            // Cold-path: scan only Mnemo.* assemblies, and only their exported types.
            // SelectMany(a => a.GetTypes()) over every loaded assembly was forcing type-table
            // realization for the entire AppDomain on each first miss.
            type = FindOverlayType(overlayName);
            if (type != null) _typeCache[overlayName] = type;
        }

        if (type == null) return;

        var content = Activator.CreateInstance(type);
        CreateOverlay(content!, new OverlayOptions(), overlayName);
    }

    private static Type? FindOverlayType(string overlayName)
    {
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            if (assembly.FullName?.StartsWith("Mnemo.", StringComparison.Ordinal) != true)
                continue;

            Type[] types;
            try { types = assembly.GetExportedTypes(); }
            catch { continue; }

            foreach (var t in types)
            {
                if (t.Name == overlayName || t.FullName == overlayName)
                    return t;
            }
        }
        return null;
    }

    public void Hide()
    {
        if (Overlays.Any())
        {
            var last = Overlays.Last();
            CloseOverlay(last.Id);
        }
    }

    public void CloseOverlay(string id) => CloseOverlay(id, null);

    public void CloseOverlay(string id, object? result)
    {
        foreach (var childId in Overlays.Where(o => o.Options.ParentOverlayId == id).Select(o => o.Id).ToList())
            CloseOverlay(childId, null);

        var overlay = Overlays.FirstOrDefault(o => o.Id == id);
        if (overlay != null)
        {
            Overlays.Remove(overlay);
            if (_completionSources.TryGetValue(id, out var tcs))
            {
                tcs.TrySetResult(result);
                _completionSources.Remove(id);
            }
        }
    }

    public string CreateOverlay(object content, OverlayOptions options, string? name = null)
    {
        using var scope = _perf.Measure("Overlay", "CreateOverlay", name ?? content.GetType().Name);
        var instance = new OverlayInstance
        {
            Content = content,
            Options = options,
            Name = name ?? string.Empty,
            ZIndex = Overlays.Count + 1000 // Ensure they stack correctly
        };
        Overlays.Add(instance);
        return instance.Id;
    }

    public async Task<string?> CreateDialogAsync(string title, string message, string confirmText = "OK", string cancelText = "", string? confirmIconName = null, DialogSeverity severity = DialogSeverity.Default)
    {
        var tcs = new TaskCompletionSource<object?>();
        var dialog = new DialogOverlay
        {
            Title = title,
            Description = message,
            PrimaryText = confirmText,
            SecondaryText = cancelText,
            PrimaryIcon = confirmIconName,
            IsDestructive = severity == DialogSeverity.Destructive
        };

        var id = CreateOverlay(dialog, DialogOverlayOptions(), "Dialog");
        _completionSources[id] = tcs;

        // Preserve the "returns the pressed button's text" contract: confirm → confirmText,
        // cancel → cancelText, close affordance → null.
        dialog.OnClosed = choice => CloseOverlay(id, choice.Button switch
        {
            DialogButton.Primary => confirmText,
            DialogButton.Secondary => cancelText,
            _ => null
        });

        var result = await tcs.Task;
        return result as string;
    }

    public async Task<string?> CreateInputDialogAsync(string title, string confirmText = "Save", string cancelText = "Cancel", string? description = null, string? placeholder = null, string? initialValue = null, string? confirmIconName = null)
    {
        var tcs = new TaskCompletionSource<object?>();
        var dialog = new DialogOverlay
        {
            Title = title,
            Description = description,
            Placeholder = placeholder,
            InputValue = initialValue,
            PrimaryText = confirmText,
            SecondaryText = cancelText,
            PrimaryIcon = confirmIconName,
            ShowInput = true
        };

        var id = CreateOverlay(dialog, DialogOverlayOptions(), "InputDialog");
        _completionSources[id] = tcs;

        // Only the primary button returns the entered value; cancel/close return null.
        dialog.OnClosed = choice => CloseOverlay(id, choice.Button == DialogButton.Primary ? choice.Input : null);

        var result = await tcs.Task;
        return result as string;
    }

    private static OverlayOptions DialogOverlayOptions() => new()
    {
        HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
        VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
        ShowBackdrop = true,
        CloseOnOutsideClick = false
    };
}

