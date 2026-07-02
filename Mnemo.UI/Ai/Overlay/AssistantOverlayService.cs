using System;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;

namespace Mnemo.UI.Ai.Overlay;

/// <summary>
/// Default <see cref="IAssistantOverlayService"/>: hosts the compact Ask surface inside the
/// global <see cref="IOverlayService"/> popup layer so it is reachable from anywhere, and
/// routes the "open full chat" action through navigation.
/// </summary>
public sealed class AssistantOverlayService : IAssistantOverlayService
{
    private const string ChatRoute = "chat";

    private readonly IOverlayService _overlays;
    private readonly INavigationService _navigation;
    private readonly IServiceProvider _services;

    private string? _askOverlayId;

    public AssistantOverlayService(
        IOverlayService overlays,
        INavigationService navigation,
        IServiceProvider services)
    {
        _overlays = overlays;
        _navigation = navigation;
        _services = services;
    }

    public void OpenAsk(
        string? seedContext = null,
        string? seedPrompt = null,
        bool autoSend = false,
        double? anchorPointX = null,
        double? anchorPointY = null)
    {
        Dispatcher.UIThread.Post(() =>
            OpenAskCore(seedContext, seedPrompt, autoSend, anchorPointX, anchorPointY));
    }

    public void ExplainSelection(string selectedText, double? anchorPointX = null, double? anchorPointY = null)
    {
        if (string.IsNullOrWhiteSpace(selectedText))
            return;
        OpenAsk(selectedText, seedPrompt: null, autoSend: false, anchorPointX, anchorPointY);
    }

    public void OpenChat() => Dispatcher.UIThread.Post(() =>
    {
        CloseAsk();
        _navigation.NavigateTo(ChatRoute);
    });

    public void CloseAsk()
    {
        if (_askOverlayId is { } id)
        {
            _overlays.CloseOverlay(id);
            _askOverlayId = null;
        }
    }

    private void OpenAskCore(
        string? seedContext,
        string? seedPrompt,
        bool autoSend,
        double? anchorPointX,
        double? anchorPointY)
    {
        CloseAsk();

        var vm = _services.GetRequiredService<AskOverlayViewModel>();
        var view = new AskOverlayView { DataContext = vm };

        bool anchored = anchorPointX.HasValue && anchorPointY.HasValue;
        var options = new OverlayOptions
        {
            ShowBackdrop = true,
            BackdropOpacity = anchored ? 0.0 : 0.18,
            CloseOnOutsideClick = true,
            CloseOnEscape = true,
        };

        if (anchored)
        {
            options.AnchorPointX = anchorPointX;
            options.AnchorPointY = anchorPointY;
            options.AnchorPosition = AnchorPosition.BottomCenter;
            options.AnchorOffset = new Avalonia.Thickness(0, 8, 0, 0);
        }
        else
        {
            options.HorizontalAlignment = "Center";
            options.VerticalAlignment = "Top";
            options.Margin = "0,96,0,0";
        }

        var id = _overlays.CreateOverlay(view, options, "AssistantAskOverlay");
        _askOverlayId = id;

        vm.CloseRequested += CloseAsk;
        vm.PopOutRequested += _ => OpenChat();

        vm.Seed(seedContext, seedPrompt, autoSend);
    }
}
