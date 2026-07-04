using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class EnableAiAssistantToggleSettingViewModel : ViewModelBase, IToggleSetting
{
    private readonly ISettingsService _settingsService;
    private readonly IOverlayService _overlayService;
    private readonly ILocalizationService _localization;
    private readonly string _settingsKey;
    private bool _suppressRecursive;
    private bool _confirmedApplyPending;

    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    [ObservableProperty] private bool _value;
    [ObservableProperty] private bool _isInteractionEnabled = true;

    public EnableAiAssistantToggleSettingViewModel(
        ISettingsService settingsService,
        IOverlayService overlayService,
        ILocalizationService localization,
        string settingsKey,
        string title,
        string description,
        bool defaultValue = false,
        bool isInteractionEnabled = true)
    {
        _settingsService = settingsService;
        _overlayService = overlayService;
        _localization = localization;
        _settingsKey = settingsKey;
        _title = title;
        _description = description;
        _isInteractionEnabled = isInteractionEnabled;
        _value = _settingsService.GetAsync(settingsKey, defaultValue).GetAwaiter().GetResult();
    }

    partial void OnValueChanged(bool value)
    {
        if (_suppressRecursive)
            return;

        if (value && !_confirmedApplyPending)
        {
            _suppressRecursive = true;
            Value = false;
            _suppressRecursive = false;
            _ = ConfirmEnableAsync();
            return;
        }

        if (value && _confirmedApplyPending)
        {
            _confirmedApplyPending = false;
            _ = _settingsService.SetAsync(_settingsKey, true);
            return;
        }

        _ = _settingsService.SetAsync(_settingsKey, false);
    }

    private async Task ConfirmEnableAsync()
    {
        var continueLabel = _localization.T("EnableAIAssistantWarningConfirm", "Settings");
        var cancelLabel = _localization.T("Cancel", "Common");
        var result = await _overlayService.CreateDialogAsync(
            _localization.T("EnableAIAssistantWarningTitle", "Settings"),
            _localization.T("EnableAIAssistantWarningMessage", "Settings"),
            continueLabel,
            cancelLabel).ConfigureAwait(true);
        if (result != continueLabel)
            return;

        _confirmedApplyPending = true;
        _suppressRecursive = true;
        Value = true;
        _suppressRecursive = false;
    }
}
