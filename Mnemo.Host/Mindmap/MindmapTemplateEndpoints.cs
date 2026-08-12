using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Mindmap;
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
            return MindmapJson.Ok(new MindmapTemplatesDto(
                templates.Default.Id,
                templates.All,
                templates.BuiltIns.Select(template => template.Id).ToList()));
        });

        // How many levels the save dialog may offer, asked before it opens. The count comes from the
        // same walk that does the capture rather than a client-side reading of the document, so the
        // number in the picker cannot promise a level the capture would then skip.
        endpoints.MapGet("/api/mindmaps/{mapId}/style-capture/{rootId}", async (
            string mapId,
            string rootId,
            IMindmapService maps,
            CancellationToken cancellationToken) =>
        {
            var document = (await maps.GetAsync(mapId, cancellationToken).ConfigureAwait(false)).Value;
            if (document is null)
                return UnknownMap(mapId);

            return MindmapJson.Ok(new MindmapCaptureInfoDto(MindmapTemplateCapture.AvailableLevels(document, rootId)));
        });

        // Capturing runs here, not in the client, for the same reason the cascade resolves against
        // served templates: which style represents a depth band is a rule with a tie-break in it, and a
        // second implementation of it would eventually disagree about what a saved template looks like.
        endpoints.MapPost("/api/mindmaps/{mapId}/style-capture", async (
            string mapId,
            HttpRequest request,
            IMindmapService maps,
            IMindmapStyleTemplateProvider templates,
            CancellationToken cancellationToken) =>
        {
            var (ok, body, error) = await MindmapJson
                .ReadAsync<MindmapCaptureTemplateDto>(request.Body, cancellationToken)
                .ConfigureAwait(false);
            if (!ok)
                return error!;

            var name = body!.Name?.Trim();
            if (string.IsNullOrEmpty(name))
                return Results.BadRequest(new ErrorDto("invalid_name", "A template name is required."));
            if (string.IsNullOrWhiteSpace(body.RootId))
                return Results.BadRequest(new ErrorDto("invalid_root", "A node to capture from is required."));

            var document = (await maps.GetAsync(mapId, cancellationToken).ConfigureAwait(false)).Value;
            if (document is null)
                return UnknownMap(mapId);

            // Nothing styled anywhere under the node means there is nothing to reproduce, and a template
            // of no rules would sit in the picker doing nothing.
            if (MindmapTemplateCapture.AvailableLevels(document, body.RootId) <= 0)
                return Results.BadRequest(new ErrorDto("nothing_to_capture", "That branch has no styles to save."));

            var template = MindmapTemplateCapture.Capture(
                document, body.RootId, $"user-{Guid.NewGuid():N}", name, body.Levels);

            await templates.SaveAsync(template, cancellationToken).ConfigureAwait(false);
            return MindmapJson.Ok(template);
        });

        endpoints.MapDelete("/api/mindmaps/templates/{id}", async (
            string id,
            IMindmapStyleTemplateProvider templates,
            CancellationToken cancellationToken) =>
        {
            // A built-in is not in the store, so deleting one would report success and change nothing.
            // Refusing says what actually happened.
            if (templates.BuiltIns.Any(template => string.Equals(template.Id, id, StringComparison.Ordinal)))
                return Results.BadRequest(new ErrorDto("built_in_template", "A built-in template cannot be deleted."));

            await templates.DeleteAsync(id, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    private static IResult UnknownMap(string id) =>
        Results.NotFound(new ErrorDto("unknown_mindmap", $"No mindmap '{id}'."));
}
