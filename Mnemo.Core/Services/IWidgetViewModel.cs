using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.Core.Services;

/// <summary>
/// Runtime content of one widget instance on the overview board. Implementations live in the
/// UI layer but the contract is Avalonia-free; views are resolved from the ViewModel by the
/// application's ViewLocator.
/// </summary>
public interface IWidgetViewModel : IDisposable
{
    /// <summary>Manifest of the widget type this instance belongs to.</summary>
    WidgetManifest Manifest { get; }

    /// <summary>Current span on the board; the host updates it when the user resizes so views can adapt.</summary>
    WidgetSize CurrentSize { get; set; }

    /// <summary>True while the board is in edit mode; widgets should suppress interactions while editing.</summary>
    bool IsEditing { get; set; }

    /// <summary>Loads the widget's data after creation. Must not throw for missing/empty data.</summary>
    Task InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>Re-queries the widget's data (returning to the page, settings change, source data invalidated).</summary>
    Task RefreshAsync(CancellationToken cancellationToken = default);
}
