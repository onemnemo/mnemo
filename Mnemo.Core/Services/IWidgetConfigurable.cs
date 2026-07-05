using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.Core.Services;

/// <summary>
/// Implemented by widget ViewModels that expose per-instance settings. The config dialog is
/// generated from <see cref="GetSupportedSettings"/>; values are read and written per instance
/// and persisted on the owning <see cref="Mnemo.Core.Models.Widgets.WidgetInstance"/>.
/// </summary>
public interface IWidgetConfigurable
{
    /// <summary>Schemas of the settings this widget supports.</summary>
    IReadOnlyList<WidgetSettingSchema> GetSupportedSettings();

    /// <summary>Current effective values (stored value or schema default) keyed by setting key.</summary>
    Task<IReadOnlyDictionary<string, string>> GetConfigAsync(CancellationToken cancellationToken = default);

    /// <summary>Applies new values and refreshes the widget's data to reflect them.</summary>
    Task SetConfigAsync(IReadOnlyDictionary<string, string> values, CancellationToken cancellationToken = default);
}
