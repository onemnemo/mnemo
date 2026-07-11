namespace Mnemo.UI.Modules.Settings.ViewModels;

/// <summary>One entry in a model picker: the provider model id and the name shown to the user.</summary>
public sealed class ModelOptionViewModel
{
    public string Id { get; }

    public string DisplayName { get; }

    public ModelOptionViewModel(string id, string displayName)
    {
        Id = id;
        DisplayName = displayName;
    }
}
