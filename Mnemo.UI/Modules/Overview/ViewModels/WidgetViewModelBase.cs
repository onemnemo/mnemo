using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Overview.ViewModels;

/// <summary>
/// Base class for widget content ViewModels. Owns the per-instance settings bag and implements
/// the schema-driven config contract: the schema comes from the manifest, values fall back to
/// schema defaults, and applying new values triggers a data refresh.
/// The board calls <see cref="InitializeAsync"/>/<see cref="RefreshAsync"/> on the UI thread;
/// implementations must not use <c>ConfigureAwait(false)</c> before mutating bound state.
/// </summary>
public abstract partial class WidgetViewModelBase : ViewModelBase, IWidgetViewModel, IWidgetConfigurable
{
    private readonly Dictionary<string, string> _settings;

    /// <inheritdoc cref="IWidgetViewModel.Manifest"/>
    public WidgetManifest Manifest { get; }

    /// <inheritdoc cref="IWidgetViewModel.CurrentSize"/>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsNarrow))]
    private WidgetSize _currentSize;

    /// <summary>True when the widget spans a single column; views stack their content vertically.</summary>
    public bool IsNarrow => CurrentSize.Columns <= 1;

    /// <inheritdoc cref="IWidgetViewModel.IsEditing"/>
    [ObservableProperty]
    private bool _isEditing;

    protected WidgetViewModelBase(WidgetManifest manifest, WidgetInstance instance)
    {
        Manifest = manifest;
        CurrentSize = instance.Size;
        _settings = new Dictionary<string, string>(instance.Settings, System.StringComparer.Ordinal);
    }

    /// <summary>Loads the widget's data. Override to query services; never throw for missing data.</summary>
    public virtual Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <summary>Re-queries the widget's data. Defaults to re-running <see cref="InitializeAsync"/>.</summary>
    public virtual Task RefreshAsync(CancellationToken cancellationToken = default) => InitializeAsync(cancellationToken);

    public IReadOnlyList<WidgetSettingSchema> GetSupportedSettings() => Manifest.Settings;

    public Task<IReadOnlyDictionary<string, string>> GetConfigAsync(CancellationToken cancellationToken = default)
    {
        var effective = new Dictionary<string, string>(System.StringComparer.Ordinal);
        foreach (var schema in Manifest.Settings)
            effective[schema.Key] = WidgetSettingValues.GetString(_settings, schema);
        return Task.FromResult<IReadOnlyDictionary<string, string>>(effective);
    }

    public async Task SetConfigAsync(IReadOnlyDictionary<string, string> values, CancellationToken cancellationToken = default)
    {
        foreach (var (key, value) in values)
            _settings[key] = value;
        await RefreshAsync(cancellationToken);
    }

    /// <summary>Effective string value of the setting with <paramref name="key"/> (stored value or schema default).</summary>
    protected string GetStringSetting(string key)
    {
        var schema = FindSchema(key);
        return schema == null ? string.Empty : WidgetSettingValues.GetString(_settings, schema);
    }

    /// <summary>Effective integer value of the setting with <paramref name="key"/>.</summary>
    protected int GetIntSetting(string key)
    {
        var schema = FindSchema(key);
        return schema == null ? 0 : WidgetSettingValues.GetInt(_settings, schema);
    }

    /// <summary>Effective boolean value of the setting with <paramref name="key"/>.</summary>
    protected bool GetBoolSetting(string key)
    {
        var schema = FindSchema(key);
        return schema != null && WidgetSettingValues.GetBool(_settings, schema);
    }

    private WidgetSettingSchema? FindSchema(string key)
        => Manifest.Settings.FirstOrDefault(s => string.Equals(s.Key, key, System.StringComparison.Ordinal));

    /// <summary>Releases event subscriptions and other resources. Base implementation holds none.</summary>
    public virtual void Dispose()
    {
    }
}
