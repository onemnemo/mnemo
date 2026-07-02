using System;
using System.Reflection;
using System.Threading.Tasks;
using Mnemo.Core.Models.Tools;
using Mnemo.Core.Models.Tools.Application;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Tools;

public sealed class ApplicationToolService
{
    private readonly INavigationService _nav;
    private readonly IMainThreadDispatcher _ui;

    public ApplicationToolService(INavigationService nav, IMainThreadDispatcher ui)
    {
        _nav = nav;
        _ui = ui;
    }

    public Task<ToolInvocationResult> GetVersionAsync(EmptyToolParameters _) =>
        Task.FromResult(ToolInvocationResult.Success("Version info.", new
        {
            informational_version = Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                ?.InformationalVersion
                ?? "unknown",
            assembly_version = Assembly.GetEntryAssembly()?.GetName().Version?.ToString() ?? "unknown"
        }));

    public Task<ToolInvocationResult> GetCurrentRouteAsync(EmptyToolParameters _) =>
        Task.FromResult(ToolInvocationResult.Success("Current route.", new
        {
            route = _nav.CurrentRoute,
            viewModel = _nav.CurrentViewModel?.GetType().Name
        }));

    public async Task<ToolInvocationResult> NavigateToAsync(NavigateToParameters p)
    {
        if (string.IsNullOrWhiteSpace(p.Destination))
            return ToolInvocationResult.Failure(ToolResultCodes.ValidationError, "destination is required.");

        var dest = p.Destination.Trim().ToLowerInvariant();
        string route = dest switch
        {
            "overview" => "overview",
            "notes" => "notes",
            "chat" => "chat",
            "mindmap" => "mindmap",
            "settings" => "settings",
            _ => dest
        };

        await _ui.InvokeAsync(() =>
        {
            if (!string.IsNullOrWhiteSpace(p.EntityId))
                _nav.NavigateTo(route, p.EntityId!.Trim());
            else
                _nav.NavigateTo(route);
            return Task.CompletedTask;
        }).ConfigureAwait(false);

        return ToolInvocationResult.Success($"Navigated to '{route}'.", new { route, entity_id = p.EntityId });
    }

    public async Task<ToolInvocationResult> OpenSettingsAsync(OpenSettingsParameters p)
    {
        await _ui.InvokeAsync(() =>
        {
            _nav.NavigateTo("settings", p.Section);
            return Task.CompletedTask;
        }).ConfigureAwait(false);

        return ToolInvocationResult.Success("Opened settings.", new { section = p.Section });
    }
}
