using System;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Updates.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Updates.ViewModels;

/// <summary>Notice that this release line cannot update to the rebuilt app and points at its download page.</summary>
public partial class RebuildNoticeViewModel : ViewModelBase
{
    private readonly IOverlayService _overlayService;
    private string? _overlayId;

    public RebuildNoticeViewModel(ILocalizationService localization, IOverlayService overlayService)
    {
        _overlayService = overlayService;
        Title = localization.T("RebuildNoticeTitle", "Settings");
        Body = localization.T("RebuildNoticeBody", "Settings");
        BetaLabel = localization.T("RebuildNoticeBetaPill", "Settings");
        DownloadLabel = localization.T("RebuildNoticeDownload", "Settings");
        LaterLabel = localization.T("RebuildNoticeLater", "Settings");
    }

    public string Title { get; }
    public string Body { get; }
    public string BetaLabel { get; }
    public string DownloadLabel { get; }
    public string LaterLabel { get; }

    public void SetOverlayId(string id) => _overlayId = id;

    /// <summary>Fired right before the overlay is closed.</summary>
    public event Action? OverlayClosed;

    private void CloseSelf()
    {
        OverlayClosed?.Invoke();
        if (!string.IsNullOrEmpty(_overlayId))
            _overlayService.CloseOverlay(_overlayId);
    }

    [RelayCommand]
    private async Task DownloadAsync()
    {
        await UpdateReleaseLauncher.LaunchDownloadPageAsync().ConfigureAwait(true);
        CloseSelf();
    }

    [RelayCommand]
    private void Later() => CloseSelf();
}
