using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class ActionSettingViewModel : ViewModelBase, ISettingsSearchable
{
    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    [ObservableProperty] private string _actionText;

    public ICommand? ActionCommand { get; }

    public bool HasAction => ActionCommand != null;

    public ActionSettingViewModel(string title, string description, string actionText, ICommand? actionCommand = null)
    {
        _title = title;
        _description = description;
        _actionText = actionText;
        ActionCommand = actionCommand;
    }
}

