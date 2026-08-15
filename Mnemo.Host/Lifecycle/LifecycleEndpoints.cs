using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// The client's half of the shutdown handshake: the window told the SPA it was
/// closing, and this is the SPA saying it has finished saving. Plus the things only
/// the host can do on the SPA's behalf: leave the window, and show a folder.
/// </summary>
public static class LifecycleEndpoints
{
    /// <param name="Url">An absolute http or https URL. Anything else is refused.</param>
    public sealed record OpenExternalRequest(string Url);

    /// <param name="Target">A directory name the host knows, never a path. See <see cref="ResolveFolder"/>.</param>
    public sealed record OpenFolderRequest(string Target);

    /// <param name="Title">The dialog's title. Supplied by the caller because the SPA holds the
    /// translations and this process has no idea what language the window is running in.</param>
    /// <param name="StartPath">Where the chooser should open. Ignored if it is not a directory.</param>
    public sealed record PickFolderRequest(string? Title, string? StartPath);

    /// <param name="Available">False when there is no window to raise a native dialog on.</param>
    /// <param name="Folders">Where exports have gone, most recent first. Never empty.</param>
    public sealed record ExportFoldersDto(bool Available, IReadOnlyList<string> Folders);

    /// <param name="Path">The chosen folder, or null if the chooser was dismissed.</param>
    public sealed record PickedFolderDto(string? Path);

    /// <summary>What a folder request resolved to.</summary>
    public enum OpenFolderOutcome
    {
        /// <summary>A known target, and the directory is there.</summary>
        Ready,
        /// <summary>Not one of the names this host will open.</summary>
        UnknownTarget,
        /// <summary>A known target whose directory does not exist.</summary>
        MissingDirectory,
    }

    /// <summary>
    /// Turns a target name into one of the app's own directories.
    /// </summary>
    /// <remarks>
    /// The security boundary of the open-folder endpoint. Its request carries a name and
    /// nothing else, so the only strings that can ever reach the shell are the ones built
    /// here out of the host's own locations. A name that is not on this list resolves to
    /// nothing, and no path from a caller is ever consulted, sanitised or repaired.
    /// </remarks>
    public static OpenFolderOutcome ResolveFolder(string? target, out string path)
    {
        path = target switch
        {
            // Asked of the paths helper rather than rebuilt here, so the folder this
            // opens is the one the logger writes into under any data root.
            "logs" => MnemoAppPaths.GetLogsDirectory(),
            "data" => MnemoAppPaths.GetLocalUserDataRoot(),
            _ => string.Empty,
        };

        if (path.Length == 0)
            return OpenFolderOutcome.UnknownTarget;

        // Nothing creates the log directory until something is logged, and the data root
        // can be moved out from under a running app. Launching the shell at a path that is
        // not there answers with a file manager error instead of an explanation.
        return Directory.Exists(path) ? OpenFolderOutcome.Ready : OpenFolderOutcome.MissingDirectory;
    }

    public static void MapLifecycle(this IEndpointRouteBuilder endpoints)
    {
        // Unconditional: the gate only ever waits after it has asked, so an
        // unsolicited call resolves a wait that is not running and does nothing.
        endpoints.MapPost("/api/app/shutdown-ready", (ShutdownGate gate) =>
        {
            gate.SignalReady();
            return Results.NoContent();
        });

        // Hands a link to the operating system's default browser.
        //
        // The SPA cannot do this itself. The window is chromeless and has no tabs, so a
        // navigation would replace the application with a web page and leave no way back,
        // and PhotinoX exposes no new-window hook to intercept `window.open` with.
        //
        // The scheme allowlist is the whole security boundary here: UseShellExecute hands
        // the string to the shell, which would happily launch a `file:` path or a
        // registered protocol handler. Only the two schemes a link in this UI can
        // legitimately carry get through.
        endpoints.MapPost("/api/app/open-external", (OpenExternalRequest body) =>
        {
            if (!Uri.TryCreate(body.Url, UriKind.Absolute, out var uri))
                return Results.BadRequest(new { error = "invalid_url" });

            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
                return Results.BadRequest(new { error = "unsupported_scheme" });

            try
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception)
            {
                // No browser, or the shell refused. Nothing to recover, but the caller
                // should hear about it rather than watch a button do nothing.
                return Results.Problem("Could not open the link.", statusCode: StatusCodes.Status502BadGateway);
            }

            return Results.NoContent();
        });

        // Shows one of the app's own directories in the system file manager.
        //
        // Separate from open-external rather than a scheme added to it: that endpoint
        // takes a caller's string and decides whether to trust it, and a `file:` URL
        // would be exactly the string worth not trusting. Here the caller picks from a
        // list of names and the host supplies the path.
        endpoints.MapPost("/api/app/open-folder", (OpenFolderRequest body) =>
        {
            switch (ResolveFolder(body.Target, out var path))
            {
                case OpenFolderOutcome.UnknownTarget:
                    return Results.BadRequest(new { error = "unknown_target" });
                case OpenFolderOutcome.MissingDirectory:
                    // Coded, because a host that predates this route answers the same 404
                    // and the client would otherwise report a missing folder to someone
                    // whose only problem is a stale binary.
                    return Results.Json(
                        new ErrorDto("missing_directory", "That folder does not exist yet."),
                        statusCode: StatusCodes.Status404NotFound);
            }

            try
            {
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            }
            catch (Exception)
            {
                return Results.Problem("Could not open the folder.", statusCode: StatusCodes.Status502BadGateway);
            }

            return Results.NoContent();
        });

        // Where a "save to a folder" control should point before the user has said otherwise, and
        // whether that control can offer to browse at all.
        endpoints.MapGet("/api/app/export-folders", async (ISettingsService settings, NativeFolderPicker picker) =>
            new ExportFoldersDto(picker.IsAvailable, await ExportFolders.ListAsync(settings).ConfigureAwait(false)));

        // Raises the system folder chooser. Only the host can: a web page cannot open one, and the
        // directory handle the File System Access API would hand back is not a path anything else
        // here could write to.
        endpoints.MapPost("/api/app/export-folders/pick", async (PickFolderRequest? body, NativeFolderPicker picker) =>
        {
            if (!picker.IsAvailable)
                return Results.Json(
                    new ErrorDto("no_window", "This build has no window to open a folder chooser on."),
                    statusCode: StatusCodes.Status501NotImplemented);

            var title = string.IsNullOrWhiteSpace(body?.Title) ? "Choose a folder" : body!.Title!.Trim();
            var chosen = await picker.PickAsync(title, body?.StartPath).ConfigureAwait(false);
            // Dismissed is an outcome, not a failure, so it answers 200 with nothing chosen rather
            // than a status the caller has to tell apart from a real error.
            return Results.Ok(new PickedFolderDto(chosen));
        });
    }
}
