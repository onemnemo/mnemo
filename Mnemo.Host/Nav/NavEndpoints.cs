using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.HeadlessShell;

namespace Mnemo.Host.Nav;

/// <summary>
/// Serves the sidebar model the SPA renders, built from the module registrations
/// themselves (via <see cref="ISidebarService"/>) rather than a list hardcoded in
/// the frontend.
/// </summary>
public static class NavEndpoints
{
    public static void MapNav(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/nav", async (HeadlessSidebarService sidebar, ISettingsService settings) =>
        {
            // The assistant entry appears only while the assistant does, which means both
            // its own switch and the developer mode that switch lives behind.
            var aiEnabled = await AiAvailability.IsEnabledAsync(settings).ConfigureAwait(false);

            return sidebar.BuildNavModel()
                .Select(category => new NavCategoryDto(
                    category.Key,
                    category.Ns,
                    category.Order,
                    category.Footer,
                    category.Items
                        .Select(item => new NavItemDto(
                            item.Route,
                            item.LabelKey,
                            item.Ns,
                            NormalizeIcon(item.Icon),
                            item.Order,
                            item.ChildRoutes,
                            IsVisible(item.Visibility, aiEnabled)))
                        .ToList()))
                .ToList();
        });
    }

    private static bool IsVisible(SidebarItemVisibilityRequirement requirement, bool aiEnabled) =>
        requirement != SidebarItemVisibilityRequirement.AiAssistantEnabled || aiEnabled;

    /// <summary>
    /// Maps a desktop icon resource path (<c>avares://Mnemo.UI/Icons/Sidebar/overview.svg</c>)
    /// to the SPA icon id (<c>sidebar/overview</c>) its asset registry resolves.
    /// </summary>
    private static string NormalizeIcon(string icon)
    {
        const string marker = "/Icons/";
        var index = icon.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        var tail = index >= 0 ? icon[(index + marker.Length)..] : icon;
        if (tail.EndsWith(".svg", StringComparison.OrdinalIgnoreCase))
            tail = tail[..^4];
        return tail.ToLowerInvariant();
    }
}
