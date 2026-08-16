using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Services.Mindmap;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// Reading and writing mindmap payloads through the storage serializer rather than the host's default
/// one.
/// <para>
/// It has to be this serializer and not ASP.NET's: element content is a polymorphic family behind
/// <c>IElementContent</c>, which the default options write as an empty object and cannot read back at
/// all. Routing every mindmap body through the same options the store uses also means the JSON the SPA
/// receives is the JSON on disk, so a new content kind or style field reaches the client the day it is
/// added instead of the day someone remembers to widen a DTO.
/// </para>
/// <para>
/// Those options omit default-valued properties, which is why the SPA's types treat everything but the
/// required keys as optional. On a five-thousand element document that omission is most of the payload.
/// </para>
/// </summary>
public static class MindmapJson
{
    public static JsonSerializerOptions Options => MindmapDocumentSerializer.Options;

    /// <summary>200 carrying <paramref name="value"/> as mindmap JSON.</summary>
    public static IResult Ok<T>(T value) =>
        Results.Content(JsonSerializer.Serialize(value, Options), "application/json");

    /// <summary>A non-200 response carrying mindmap JSON, for the conflict and error bodies.</summary>
    public static IResult Json<T>(T value, int statusCode) =>
        Results.Content(JsonSerializer.Serialize(value, Options), "application/json", statusCode: statusCode);

    /// <summary>
    /// Deserializes a request body. Returns false with a ready-made 400 when the body is absent or
    /// malformed, so no endpoint has to grow its own try/catch around the same JsonException.
    /// Takes the stream rather than the request so the handlers stay callable from a test without
    /// an HttpContext.
    /// </summary>
    public static async Task<(bool Ok, T? Value, IResult? Error)> ReadAsync<T>(
        Stream body,
        CancellationToken cancellationToken) where T : class
    {
        try
        {
            var value = await JsonSerializer
                .DeserializeAsync<T>(body, Options, cancellationToken)
                .ConfigureAwait(false);

            return value is null
                ? (false, null, Results.BadRequest(new ErrorDto("invalid_body", "A request body is required.")))
                : (true, value, null);
        }
        catch (JsonException ex)
        {
            return (false, null, Results.BadRequest(new ErrorDto("invalid_body", ex.Message)));
        }
    }
}
