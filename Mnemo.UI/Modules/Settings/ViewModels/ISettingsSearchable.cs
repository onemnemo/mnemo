namespace Mnemo.UI.Modules.Settings.ViewModels;

/// <summary>
/// Implemented by setting item ViewModels so the Settings search box can match
/// on the text the user actually sees (title and description).
/// </summary>
public interface ISettingsSearchable
{
    string Title { get; }

    string Description { get; }
}
