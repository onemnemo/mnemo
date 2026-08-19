using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Trash;

/// <summary>
/// The filters every trash route carries.
/// </summary>
public static class TrashReady
{
    /// <summary>
    /// Closes a trash route until reconciliation has run, and turns the two protocol failures into
    /// the codes the SPA acts on.
    /// </summary>
    public static RouteHandlerBuilder RequireTrash(this RouteHandlerBuilder builder) =>
        builder.RequireTrashReconciled().ReportTrashFailures();

    /// <summary>
    /// Closes a trash route until reconciliation has run.
    /// </summary>
    /// <remarks>
    /// Reads are gated too. Before reconciliation the ledger can still hold rows an interrupted
    /// operation left behind, and listing those would offer a person a restore button for content
    /// that is already back where it belongs.
    /// <para>
    /// 503 rather than 500 because it is a real state the client can act on: the app is starting.
    /// </para>
    /// </remarks>
    public static RouteHandlerBuilder RequireTrashReconciled(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var maintenance = context.HttpContext.RequestServices.GetRequiredService<TrashMaintenance>();
            if (maintenance.IsReady)
                return await next(context).ConfigureAwait(false);

            return Results.Json(
                new ErrorDto("trash_reconciling", "The trash is unavailable until it finishes starting."),
                statusCode: StatusCodes.Status503ServiceUnavailable);
        });

    /// <summary>
    /// Turns a request for a kind this build does not ship, and a module that could not answer,
    /// into structured codes rather than a generic failure.
    /// </summary>
    public static RouteHandlerBuilder ReportTrashFailures(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            try
            {
                return await next(context).ConfigureAwait(false);
            }
            catch (UnknownTrashKindException ex)
            {
                return Results.BadRequest(new ErrorDto(
                    "unknown_trash_kind",
                    $"No module in this build owns trash kind '{ex.Kind}'."));
            }
            catch (TrashSourceUnavailableException ex)
            {
                // The ledger is consistent and a background pass will resolve the entry, so this
                // is worth retrying rather than reporting as a bug in the request.
                return Results.Json(
                    new ErrorDto(
                        "trash_source_unavailable",
                        $"The module that owns '{ex.Kind}' could not complete the request."),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });
}
