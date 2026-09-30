using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Branding;

/// <summary>The app icon the SPA renders from the chosen logo, handed to the host to show.</summary>
public static class BrandIconEndpoints
{
    /// <param name="Key">The stored icon's key, or null while the shipped default is in force.</param>
    /// <param name="Format">The one file shape a PUT must carry, or null where no window takes one.</param>
    public sealed record BrandIconDto(string? Key, string? Format);

    /// <param name="Key">Names the rendering, so the SPA can tell whether the host already has it.</param>
    /// <param name="Data">The file for <see cref="BrandIconDto.Format"/>, base64 encoded.</param>
    public sealed record BrandIconPutRequest(string? Key, string? Data);

    public static void MapBrandIcon(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/app/brand-icon", (BrandIconService icons) =>
            new BrandIconDto(icons.CurrentKey, icons.Format));

        endpoints.MapPut("/api/app/brand-icon", async (HttpRequest request, BrandIconService icons, CancellationToken cancellationToken) =>
        {
            // Read by hand so the cap is lowered before binding reads the body.
            var sizeLimit = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (sizeLimit is { IsReadOnly: false })
                sizeLimit.MaxRequestBodySize = BrandIconService.MaxBodyBytes;
            if (request.ContentLength > BrandIconService.MaxBodyBytes)
                return TooLarge();
            if (!request.HasJsonContentType())
                return Results.BadRequest(new ErrorDto("invalid_body", "Expected a JSON body."));

            BrandIconPutRequest? body;
            try
            {
                body = await request.ReadFromJsonAsync<BrandIconPutRequest>(cancellationToken).ConfigureAwait(false);
            }
            catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                return TooLarge();
            }
            catch (JsonException)
            {
                return Results.BadRequest(new ErrorDto("invalid_body", "The body is not a brand icon request."));
            }

            var error = await icons.StoreAsync(body?.Key, body?.Data, cancellationToken).ConfigureAwait(false);
            return error switch
            {
                null => Results.NoContent(),
                "too_large" => TooLarge(),
                "unsupported" => Results.Json(
                    new ErrorDto(error, "This host has no window to show an app icon on."),
                    statusCode: StatusCodes.Status409Conflict),
                "write_failed" => Results.Json(
                    new ErrorDto(error, "The app icon could not be saved."),
                    statusCode: StatusCodes.Status500InternalServerError),
                _ => Results.BadRequest(new ErrorDto(error, "That is not a usable app icon.")),
            };
        });

        endpoints.MapDelete("/api/app/brand-icon", async (BrandIconService icons, CancellationToken cancellationToken) =>
        {
            return await icons.ClearAsync(cancellationToken).ConfigureAwait(false)
                ? Results.NoContent()
                : Results.Json(
                    new ErrorDto("write_failed", "The app icon could not be reset."),
                    statusCode: StatusCodes.Status500InternalServerError);
        });
    }

    private static IResult TooLarge() => Results.Json(
        new ErrorDto("too_large", $"The icon exceeds {BrandIconService.MaxBodyBytes / (1024 * 1024)} MB."),
        statusCode: StatusCodes.Status413PayloadTooLarge);
}
