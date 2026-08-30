using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Transfer;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Where a route that produces a file puts it: the destination the user chose, or the response.
/// </summary>
/// <remarks>
/// Every export the host produces already writes a local file, because that is the shape the
/// import and export adapters work in. So a chosen destination costs nothing extra: it is simply
/// the path that file is written to. Nothing streams out to the page and back.
///
/// The write goes beside the destination rather than over it. A package or a render takes seconds
/// to produce, so opening the real file to truncate it up front would let a full disk or a closed
/// window leave a stub where the user's last good export is. Writing a sibling first makes the
/// final step a rename within one directory, which is free.
/// </remarks>
internal static class ExportDestination
{
    /// <summary>
    /// Spends the grant a save chooser minted, if the caller sent one.
    /// </summary>
    /// <remarks>
    /// No grant is not an error: it is a caller with nowhere to put a file, which is the dev server
    /// in a browser tab, and it gets the bytes in the response as before. A grant that will not
    /// spend is, because somebody asked to write to a destination nobody chose.
    /// </remarks>
    /// <returns>The response to send instead of exporting, or null to carry on.</returns>
    public static IResult? Claim(string? grant, ExportGrants grants, out ExportTarget? target)
    {
        target = null;
        if (string.IsNullOrWhiteSpace(grant))
            return null;

        if (grants.TryConsume(grant, out target))
            return null;

        return Results.BadRequest(
            new ErrorDto("unknown_grant", "That destination was not chosen, or the choice has lapsed."));
    }

    /// <summary>
    /// Where the producing route should write. A sibling of the destination, or a staging file when
    /// there is no destination and the bytes are going out over HTTP.
    /// </summary>
    /// <param name="extension">Only read when there is no destination, to name the staging file.</param>
    public static string PathFor(ExportTarget? target, string extension = "")
    {
        if (target is not null)
        {
            Directory.CreateDirectory(target.Directory);
            return target.FullPath + ".part";
        }

        // Swept here as well as on upload, so somebody who only ever exports still reclaims what a
        // failed export left behind.
        TransferStagingStore.SweepStale();
        return TransferStagingStore.CreateExportPath(extension);
    }

    /// <summary>
    /// Puts a finished file in place and remembers its folder. Only reached once the write
    /// succeeded: a folder that could not be written to is not one to offer first the next time.
    /// </summary>
    public static async Task<IResult> CommitAsync(ExportTarget target, string pending, ISettingsService settings)
    {
        File.Move(pending, target.FullPath, overwrite: true);
        await ExportFolders.RememberAsync(settings, target.Directory).ConfigureAwait(false);
        return Results.Ok(new ExportSavedDto(target.FullPath));
    }

    /// <summary>
    /// Answers a write that failed for a reason the person who chose the folder can fix: a
    /// read-only folder, a removed drive, a file open in another app. Theirs to act on rather than
    /// a fault to bury in the log alone, so it is both logged and reported.
    /// </summary>
    public static IResult Failed(ExportTarget target, string pending, ILoggerService logger, string category, Exception ex)
    {
        Discard(pending);
        logger.Warning(category, $"Could not write an export to {target.FullPath}: {ex.Message}");
        return Results.Json(
            new ErrorDto("write_failed", "The file could not be written to that folder."),
            statusCode: StatusCodes.Status409Conflict);
    }

    /// <summary>Removes a file no response will ever read. A failure here is not worth reporting
    /// over the one that brought us into the catch.</summary>
    public static void Discard(string path)
    {
        if (!string.IsNullOrEmpty(path))
            TransferStagingStore.TryDeleteFile(path);
    }
}
