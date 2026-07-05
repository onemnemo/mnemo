using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.Core.Services;

/// <summary>
/// Registered widget type: a manifest plus a factory that builds the ViewModel for one
/// instance. Descriptors are registered through the module system (built-ins) or, later,
/// by the extension loader.
/// </summary>
public interface IWidgetDescriptor
{
    /// <summary>Static description of the widget type.</summary>
    WidgetManifest Manifest { get; }

    /// <summary>
    /// Creates the ViewModel for <paramref name="instance"/>. The widget reads its settings
    /// from the instance and reaches application data only through <paramref name="context"/>.
    /// </summary>
    Task<IWidgetViewModel> CreateViewModelAsync(WidgetInstance instance, IWidgetContext context, CancellationToken cancellationToken = default);
}
