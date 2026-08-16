using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Notes;

public static class NotesReady
{
    /// <summary>
    /// Closes a note endpoint until the sid backfill has finished and validated. Every note route
    /// carries this, reads included: a half-migrated corpus is one where some blocks can be addressed
    /// by sid and some cannot, and a caller that reads such a note has no way to tell which it got.
    /// <para>
    /// 503 rather than 500 because it is a real state the client can act on — the app is starting, or
    /// the migration failed and will be retried on the next launch — not a bug in the request.
    /// </para>
    /// </summary>
    public static RouteHandlerBuilder RequireNotesMigrated(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var migrator = context.HttpContext.RequestServices.GetRequiredService<INoteSidMigrator>();
            if (migrator.IsComplete)
                return await next(context).ConfigureAwait(false);

            return Results.Json(
                new ErrorDto("notes_migrating", "Notes are unavailable until the note migration completes."),
                statusCode: StatusCodes.Status503ServiceUnavailable);
        });
}
