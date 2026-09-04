using System;
using System.Linq;
using System.Threading;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services.Proofing;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Modules.Proofing;

namespace Mnemo.Host.Proofing;

/// <summary>
/// Which languages one note is checked in, when it is not checked in the ones settings names.
/// <para>
/// A note that follows settings has no stored entry, so the three modes on the wire are two modes in
/// the store plus the absence of one. That is what makes going back to the defaults a delete rather
/// than a write, and it is why the map only holds notes somebody has actually decided about.
/// </para>
/// </summary>
internal static class ProofingNoteLanguageEndpoints
{
    internal static void MapProofingNoteLanguages(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/proofing/notes/{noteId}/languages", async (
            string noteId,
            IProofingService proofing,
            CancellationToken cancellationToken) =>
        {
            if (ProofingEndpoints.BadNoteIdOrNull(noteId) is { } invalid)
                return invalid;

            return await ProofingEndpoints.NoteLanguagesAsync(proofing, noteId, cancellationToken).ConfigureAwait(false);
        });

        endpoints.MapPut("/api/proofing/notes/{noteId}/languages", async (
            string noteId,
            ProofingNoteLanguagesRequestDto? body,
            INoteLanguageService noteLanguages,
            IProofingService proofing,
            [FromServices] ProofingDictionaryCatalog catalog,
            CancellationToken cancellationToken) =>
        {
            if (ProofingEndpoints.BadNoteIdOrNull(noteId) is { } invalid)
                return invalid;

            var mode = body?.Mode ?? string.Empty;
            if (mode is not (NoteProofingMode.Default or NoteProofingMode.Custom or NoteProofingMode.Off))
            {
                return ProofingEndpoints.Refuse(
                    "proofing_mode_invalid",
                    "A note is checked in the default languages, in its own, or not at all.");
            }

            if (string.Equals(mode, NoteProofingMode.Default, StringComparison.Ordinal))
            {
                await noteLanguages.ClearAsync(noteId, cancellationToken).ConfigureAwait(false);
                return await ProofingEndpoints.NoteLanguagesAsync(proofing, noteId, cancellationToken).ConfigureAwait(false);
            }

            NoteLanguageEntry entry;
            if (string.Equals(mode, NoteProofingMode.Off, StringComparison.Ordinal))
            {
                // A note that is switched off keeps no list. The menu toggles between off and the
                // defaults, so a previous list is out of reach either way.
                entry = new NoteLanguageEntry(NoteProofingMode.Off, []);
            }
            else
            {
                var requested = body?.Languages ?? [];
                if (requested.Count == 0)
                {
                    return ProofingEndpoints.Refuse(
                        "proofing_language_required",
                        "A note checked in its own languages needs at least one.");
                }

                // The catalog is the whole population, so anything longer carries duplicates or
                // junk. Taking the first entries bounds the lookups rather than trusting the request.
                var capped = requested.Count > catalog.Entries.Count
                    ? requested.Take(catalog.Entries.Count).ToArray()
                    : requested;

                // A language with no dictionary yet is kept rather than refused: resolution filters
                // it out, so a choice made before the files ship survives until they do.
                if (capped.Any(id => catalog.Find(id) is null))
                {
                    return ProofingEndpoints.Refuse(
                        "proofing_language_unknown",
                        "A language must be one this build knows about.");
                }

                entry = new NoteLanguageEntry(NoteProofingMode.Custom, ProofingLanguages.Canonical(catalog, capped));
            }

            var stored = await noteLanguages.SetAsync(noteId, entry, cancellationToken).ConfigureAwait(false);
            if (!stored)
            {
                return ProofingEndpoints.Refuse(
                    "proofing_note_language_limit",
                    $"At most {noteLanguages.MaxNotes} notes may carry their own languages.",
                    StatusCodes.Status409Conflict);
            }

            return await ProofingEndpoints.NoteLanguagesAsync(proofing, noteId, cancellationToken).ConfigureAwait(false);
        });
    }
}
