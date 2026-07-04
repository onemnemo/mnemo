using System.ComponentModel;

namespace Mnemo.UI.Modules.Settings.ViewModels;

/// <summary>
/// Shared shape of toggle-backed setting rows (plain and confirmation-gated
/// variants), so a <see cref="SettingsGroupViewModel"/> can use any of them as
/// the master switch that gates its content.
/// </summary>
public interface IToggleSetting : ISettingsSearchable, INotifyPropertyChanged
{
    bool Value { get; set; }

    bool IsInteractionEnabled { get; }
}
