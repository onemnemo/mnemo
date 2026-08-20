using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Widgets;

/// <summary>
/// A widget that ships with Mnemo: its manifest, plus the factory that turns an instance of it
/// into something a board can render. The board is one shell's concern and the manifest is
/// every shell's, so the factory is optional and a process without one registers the manifest
/// alone. Asking such a descriptor for content is a mistake rather than a state to handle,
/// hence the throw.
/// </summary>
public sealed class BuiltInWidgetDescriptor : IWidgetDescriptor
{
    private readonly IWidgetViewModelFactory? _viewModels;

    public BuiltInWidgetDescriptor(WidgetManifest manifest, IWidgetViewModelFactory? viewModels)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        Manifest = manifest;
        _viewModels = viewModels;
    }

    public WidgetManifest Manifest { get; }

    public Task<IWidgetViewModel> CreateViewModelAsync(
        WidgetInstance instance, IWidgetContext context, CancellationToken cancellationToken = default)
    {
        if (_viewModels is null)
        {
            throw new NotSupportedException(
                $"Widget '{Manifest.WidgetId}' was registered without a view model factory, "
                + "so this process can read its manifest but cannot render it.");
        }

        return _viewModels.CreateAsync(Manifest, instance, context, cancellationToken);
    }
}
