using System;
using System.Collections.Generic;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Widgets;

/// <summary>
/// Thread-safe registry of widget descriptors. Registration happens during module startup
/// (and later from the extension loader); lookups happen from the board and the widget library.
/// </summary>
public sealed class WidgetRegistry : IWidgetRegistry
{
    private readonly object _gate = new();
    private readonly Dictionary<string, IWidgetDescriptor> _byId = new(StringComparer.Ordinal);
    private readonly List<IWidgetDescriptor> _ordered = new();

    public void Register(IWidgetDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        if (string.IsNullOrWhiteSpace(descriptor.Manifest.WidgetId))
            throw new ArgumentException("Widget descriptor must declare a non-empty WidgetId.", nameof(descriptor));

        lock (_gate)
        {
            if (!_byId.TryAdd(descriptor.Manifest.WidgetId, descriptor))
                throw new InvalidOperationException($"A widget with id '{descriptor.Manifest.WidgetId}' is already registered.");
            _ordered.Add(descriptor);
        }
    }

    public IReadOnlyList<IWidgetDescriptor> AvailableDescriptors
    {
        get
        {
            lock (_gate)
            {
                return _ordered.ToArray();
            }
        }
    }

    public IWidgetDescriptor? GetDescriptor(string widgetId)
    {
        if (string.IsNullOrWhiteSpace(widgetId))
            return null;

        lock (_gate)
        {
            return _byId.TryGetValue(widgetId, out var descriptor) ? descriptor : null;
        }
    }
}
