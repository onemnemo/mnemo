using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.Core.Services;

/// <summary>
/// Builds the runtime content of a built-in widget. A manifest is data every process reads,
/// including one that only serves the board over HTTP; the view model is presentation, so the
/// presentation layer supplies this and a process that never renders a board runs without one.
/// </summary>
public interface IWidgetViewModelFactory
{
    /// <summary>
    /// Creates the view model for <paramref name="instance"/> of the widget type
    /// <paramref name="manifest"/> describes.
    /// </summary>
    Task<IWidgetViewModel> CreateAsync(
        WidgetManifest manifest,
        WidgetInstance instance,
        IWidgetContext context,
        CancellationToken cancellationToken = default);
}
