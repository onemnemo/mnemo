using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Host.Contracts;
using Mnemo.Host.Overview;
using Xunit;

namespace Mnemo.Host.Tests.Overview;

/// <summary>
/// The bytes each outcome puts on the wire, executed rather than assumed.
/// <para>
/// The never-saved answer is the reason this file exists. It has to be a 200 with a literal
/// <c>null</c> body: the SPA parses every response body it receives, so an empty one throws a
/// parse error rather than the typed error the client classifies, and "no board yet" would stop
/// being distinguishable from "the read failed". A framework helper that quietly drops a null
/// value would break that without breaking anything that only inspects the IResult's type.
/// </para>
/// </summary>
public sealed class OverviewLayoutHttpTests
{
    [Fact]
    public async Task AStoredBoardIsA200WithTheBoard()
    {
        var layout = new OverviewLayoutDto(3, "default", [
            new WidgetInstanceDto(Guid.Parse("11111111-1111-1111-1111-111111111111"), "mnemo.recent-notes",
                new WidgetSizeDto(2, 1), 0, 0, 0, new Dictionary<string, string> { ["range"] = "week" })
        ]);

        var response = await Execute(OverviewLayoutLoadResult.Loaded(layout).ToHttpResult());

        Assert.Equal(StatusCodes.Status200OK, response.Status);
        var body = JsonSerializer.Deserialize<OverviewLayoutDto>(response.Body, WireJson)!;
        Assert.Equal(3, body.SchemaVersion);
        Assert.Equal("mnemo.recent-notes", Assert.Single(body.Widgets).WidgetId);
    }

    [Fact]
    public async Task ANeverSavedProfileIsA200WithALiteralNullBody()
    {
        var response = await Execute(OverviewLayoutLoadResult.NeverSaved().ToHttpResult());

        Assert.Equal(StatusCodes.Status200OK, response.Status);
        Assert.Equal("null", response.Body);
        Assert.StartsWith("application/json", response.ContentType);
        // The failure this guards against is an empty body, which parses as nothing at all.
        Assert.NotEqual(string.Empty, response.Body);
        Assert.Null(JsonSerializer.Deserialize<OverviewLayoutDto>(response.Body, WireJson));
    }

    [Fact]
    public async Task AFailedReadIsA500AndNotTheNullBody()
    {
        var response = await Execute(OverviewLayoutLoadResult.Failed("Corrupt payload.").ToHttpResult());

        Assert.Equal(StatusCodes.Status500InternalServerError, response.Status);
        Assert.NotEqual("null", response.Body);
        var error = JsonSerializer.Deserialize<ErrorDto>(response.Body, WireJson)!;
        Assert.Equal("overview_layout_unreadable", error.Error);
        Assert.Equal("Corrupt payload.", error.Message);
    }

    [Fact]
    public async Task ASavedBoardIsA204()
    {
        // 204 is safe here and only here: the client's write path discards empty bodies, unlike
        // its read path.
        var response = await Execute(OverviewLayoutSaveResult.Saved().ToHttpResult());

        Assert.Equal(StatusCodes.Status204NoContent, response.Status);
        Assert.Equal(string.Empty, response.Body);
    }

    [Fact]
    public async Task AMalformedBodyIsA400()
    {
        var response = await Execute(OverviewLayoutSaveResult.Malformed("Every widget needs a widgetId.").ToHttpResult());

        Assert.Equal(StatusCodes.Status400BadRequest, response.Status);
        Assert.Equal("invalid_layout", JsonSerializer.Deserialize<ErrorDto>(response.Body, WireJson)!.Error);
    }

    [Fact]
    public async Task AFailedWriteIsA500()
    {
        var response = await Execute(OverviewLayoutSaveResult.Failed("Disk is full.").ToHttpResult());

        Assert.Equal(StatusCodes.Status500InternalServerError, response.Status);
        Assert.Equal("overview_layout_unwritable", JsonSerializer.Deserialize<ErrorDto>(response.Body, WireJson)!.Error);
    }

    [Fact]
    public void ARequestBodyBindsFromTheCamelCaseJsonTheClientSends()
    {
        // The read DTOs declare their collections as interfaces, which the serializer has to be
        // able to construct on the way in as well as read on the way out. Nothing else here
        // deserializes a request body, so a shape it cannot bind would first surface as a 400 on
        // every board save.
        const string wire = """
            {
              "schemaVersion": 3,
              "profileId": "default",
              "widgets": [
                {
                  "instanceId": "11111111-1111-1111-1111-111111111111",
                  "widgetId": "mnemo.study-goals",
                  "size": { "columns": 1, "rows": 2 },
                  "column": -1,
                  "row": -1,
                  "order": 4,
                  "settings": { "goal": "20" }
                }
              ]
            }
            """;

        var body = JsonSerializer.Deserialize<OverviewLayoutDto>(wire, WireJson)!;

        Assert.Equal(3, body.SchemaVersion);
        Assert.Equal("default", body.ProfileId);
        var widget = Assert.Single(body.Widgets);
        Assert.Equal(Guid.Parse("11111111-1111-1111-1111-111111111111"), widget.InstanceId);
        Assert.Equal("mnemo.study-goals", widget.WidgetId);
        Assert.Equal(1, widget.Size.Columns);
        Assert.Equal(2, widget.Size.Rows);
        Assert.Equal(-1, widget.Column);
        Assert.Equal(-1, widget.Row);
        Assert.Equal(4, widget.Order);
        Assert.Equal("20", widget.Settings["goal"]);
    }

    [Fact]
    public void AStoredBoardSerializesToTheCamelCaseNamesTheClientMirrors()
    {
        var layout = new OverviewLayoutDto(3, "default", [
            new WidgetInstanceDto(Guid.Empty, "mnemo.recent-decks", new WidgetSizeDto(2, 1), 0, 0, 0,
                new Dictionary<string, string>())
        ]);

        var wire = JsonSerializer.Serialize(layout, WireJson);

        // Hand-mirrored types in mnemo-web/src/api/types.ts read these exact names.
        Assert.Contains("\"schemaVersion\":", wire);
        Assert.Contains("\"profileId\":", wire);
        Assert.Contains("\"instanceId\":", wire);
        Assert.Contains("\"widgetId\":", wire);
        Assert.Contains("\"columns\":", wire);
        Assert.Contains("\"settings\":", wire);
    }

    /// <summary>Matches what the minimal API emits: camelCase names, case-insensitive on read.</summary>
    private static readonly JsonSerializerOptions WireJson = new(JsonSerializerDefaults.Web);

    private sealed record Response(int Status, string Body, string? ContentType);

    /// <summary>
    /// Runs a result against a bare HttpContext and reports what reached the socket. The result
    /// implementations log through the request's services, so a logger has to be there.
    /// </summary>
    private static async Task<Response> Execute(IResult result)
    {
        var services = new ServiceCollection();
        services.AddLogging();

        await using var provider = services.BuildServiceProvider();
        using var body = new MemoryStream();
        var context = new DefaultHttpContext { RequestServices = provider };
        context.Response.Body = body;

        await result.ExecuteAsync(context);

        return new Response(context.Response.StatusCode, Encoding.UTF8.GetString(body.ToArray()), context.Response.ContentType);
    }
}
