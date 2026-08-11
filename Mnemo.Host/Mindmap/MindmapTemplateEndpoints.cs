using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// The style templates a document's cascade resolves against.
/// <para>
/// The client cannot mirror these in its own source. Six of them ship in code, but the rest are the
/// user's own, saved in the store, and a mirror would be both a second definition of the shipped six
/// and blind to every template beyond them. So the cascade runs client-side against the templates
/// served from here rather than against a copy that drifts.
/// </para>
/// </summary>
public static class MindmapTemplateEndpoints
{
    public static void MapMindmapTemplates(this IEndpointRouteBuilder endpoints)
    {
        // Refreshed per call rather than at startup: the provider's snapshot is only as current as its
        // last refresh, and a template the user saved in another window would otherwise stay invisible
        // until this process restarted. One store read against opening a map is not a cost worth
        // trading correctness for.
        endpoints.MapGet("/api/mindmaps/templates", async (
            IMindmapStyleTemplateProvider templates,
            CancellationToken cancellationToken) =>
        {
            await templates.RefreshAsync(cancellationToken).ConfigureAwait(false);
            // Which one is the default travels with them. A document that names no template resolves
            // against it, and a client that had to know its id would be mirroring a constant.
            return MindmapJson.Ok(new MindmapTemplatesDto(templates.Default.Id, templates.All));
        });
    }
}
