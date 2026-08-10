using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Host.Contracts;
using Mnemo.Host.Mindmap;
using Xunit;

namespace Mnemo.Host.Tests.Mindmap;

/// <summary>
/// The ops endpoint against a real store, executed rather than asserted about.
/// <para>
/// Three things here are load-bearing and none of them can be checked by reading the handler. The
/// batch has to survive the compact op grammar the AI tool layer also speaks. A contended revision
/// has to come back as a 409 the client can rebase on rather than a 400 it would treat as its own
/// mistake. And the response has to carry a delta pair plus the document order, because the client
/// folds the redo delta into the map it already holds instead of refetching, and sibling order lives
/// in the edge array's order, which no set-shaped delta can express.
/// </para>
/// </summary>
public sealed class MindmapOpsHttpTests
{
    [Fact]
    public async Task ABatchInTheCompactWireGrammarApplies()
    {
        await using var h = new MindmapHostHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var response = await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [
              { "op": "add", "nodes": [ { "ref": "root", "t": "Rock cycle", "c": [ { "ref": "kid", "t": "Igneous" } ] } ] }
            ] }
            """), h.Service));

        Assert.Equal(StatusCodes.Status200OK, response.Status);
        var body = Parse<MindmapOpsResultDto>(response.Body);
        Assert.Equal(map.Revision + 1, body.Revision);
        Assert.Contains("root", body.CreatedIds.Keys);
        Assert.Contains("kid", body.CreatedIds.Keys);

        var stored = (await h.Service.GetAsync(map.Id)).Value!;
        Assert.Equal(2, stored.Elements.Count);
    }

    [Fact]
    public async Task AMalformedOpIsA400CarryingTheOpItFailedOn()
    {
        await using var h = new MindmapHostHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var response = await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [
              { "op": "add", "nodes": [ { "t": "fine" } ] },
              { "op": "set" }
            ] }
            """), h.Service));

        Assert.Equal(StatusCodes.Status400BadRequest, response.Status);
        var body = Parse<MindmapEditErrorDto>(response.Body);
        Assert.Equal("validation_error", body.Code);
        Assert.Equal(1, body.FailedOpIndex);

        // Nothing partially applied: the parse runs before the service is touched at all.
        Assert.Empty((await h.Service.GetAsync(map.Id)).Value!.Elements);
    }

    [Fact]
    public async Task ContendedEditsOnTheSameElementAreA409CarryingTheCurrentRevision()
    {
        await using var h = new MindmapHostHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var nodeId = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [ { "op": "add", "nodes": [ { "ref": "n", "t": "one" } ] } ] }
            """), h.Service))).Body).CreatedIds["n"];

        // Two sessions both edit that node from the same starting revision. The first wins; the second
        // is contending for the same id, which is the case the rebase deliberately will not paper over.
        var first = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": 2, "ops": [ { "op": "set", "id": "{{nodeId}}", "t": "mine" } ] }
            """), h.Service))).Body);

        var response = await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": 2, "ops": [ { "op": "set", "id": "{{nodeId}}", "t": "theirs" } ] }
            """), h.Service));

        Assert.Equal(StatusCodes.Status409Conflict, response.Status);
        var body = Parse<MindmapEditErrorDto>(response.Body);
        Assert.Equal("rev_conflict", body.Code);
        Assert.Equal(first.Revision, body.Revision);
        Assert.Contains(nodeId, body.ContendedIds!);
    }

    [Fact]
    public async Task TheResponseCarriesADeltaPairAndTheDocumentOrder()
    {
        await using var h = new MindmapHostHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;

        var body = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [
              { "op": "add", "nodes": [ { "ref": "a", "t": "A", "c": [ { "ref": "b", "t": "B" } ] } ] }
            ] }
            """), h.Service))).Body);

        // Redo is what the batch did: both new elements and the hierarchy edge between them.
        Assert.Equal(2, body.Redo!.Elements.Count);
        Assert.Single(body.Redo.Edges);
        Assert.Empty(body.Redo.RemoveElementIds);

        // Undo is its exact inverse: remove what the batch created, restore nothing.
        Assert.Empty(body.Undo!.Elements);
        Assert.Equal(2, body.Undo.RemoveElementIds.Count);
        Assert.Single(body.Undo.RemoveEdgeIds);

        // Order is the whole document's, not the delta's, since that is what the client sorts to.
        var stored = (await h.Service.GetAsync(map.Id)).Value!;
        Assert.Equal(stored.Elements.Select(e => e.Id), body.Order!.Elements);
        Assert.Equal(stored.Edges.Select(e => e.Id), body.Order.Edges);
    }

    [Fact]
    public async Task RestoringTheUndoDeltaPutsTheDocumentBack()
    {
        await using var h = new MindmapHostHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var edit = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [ { "op": "add", "nodes": [ { "t": "gone in a moment" } ] } ] }
            """), h.Service))).Body);
        Assert.Single((await h.Service.GetAsync(map.Id)).Value!.Elements);

        var restoreBody = JsonSerializer.Serialize(
            new RestoreMindmapDto(edit.Revision, edit.Undo!), MindmapJson.Options);
        var response = await Execute(await MindmapEndpoints.RestoreAsync(map.Id, Body(restoreBody), h.Service));

        Assert.Equal(StatusCodes.Status200OK, response.Status);
        Assert.Equal(edit.Revision + 1, Parse<MindmapRestoreResultDto>(response.Body).Revision);
        Assert.Empty((await h.Service.GetAsync(map.Id)).Value!.Elements);
    }

    [Fact]
    public async Task ARestoreAgainstAMovedRevisionIsA409()
    {
        await using var h = new MindmapHostHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var edit = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [ { "op": "add", "nodes": [ { "t": "first" } ] } ] }
            """), h.Service))).Body);

        // Someone else edits, so replaying the delta verbatim would silently revert their work.
        await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{edit.Revision}}, "ops": [ { "op": "add", "nodes": [ { "t": "second" } ] } ] }
            """), h.Service);

        var restoreBody = JsonSerializer.Serialize(
            new RestoreMindmapDto(edit.Revision, edit.Undo!), MindmapJson.Options);
        var response = await Execute(await MindmapEndpoints.RestoreAsync(map.Id, Body(restoreBody), h.Service));

        Assert.Equal(StatusCodes.Status409Conflict, response.Status);
        Assert.Equal("rev_conflict", Parse<MindmapEditErrorDto>(response.Body).Code);
    }

    [Fact]
    public async Task AnEditToAMissingElementIsA404WithNearMisses()
    {
        await using var h = new MindmapHostHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var added = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [ { "op": "add", "nodes": [ { "ref": "n", "t": "here" } ] } ] }
            """), h.Service))).Body);
        var real = added.CreatedIds["n"];

        // One character off the real id, which is what a stale client or a guessing model produces.
        var typo = real[..^1] + (real[^1] == 'a' ? 'b' : 'a');
        var response = await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{added.Revision}}, "ops": [ { "op": "set", "id": "{{typo}}", "t": "x" } ] }
            """), h.Service));

        Assert.Equal(StatusCodes.Status404NotFound, response.Status);
        var body = Parse<MindmapEditErrorDto>(response.Body);
        Assert.Equal("not_found", body.Code);
        // Suggestions read "id: text" so a caller can tell which near-miss it meant, not just that one exists.
        Assert.Contains(body.Suggestions!, s => s.StartsWith(real, StringComparison.Ordinal));
    }

    [Fact]
    public void ADocumentSerializesWithItsContentDiscriminatorIntact()
    {
        // The whole reason mindmap payloads bypass the host's default serializer: element content is
        // polymorphic, and the default options write an interface as an empty object.
        var document = new MindmapDocument
        {
            Id = "m1",
            Elements = [new MindmapElement { Id = "e1", Content = new TaskContent { Text = "do it", Done = true } }],
        };

        var wire = JsonSerializer.Serialize(document, MindmapJson.Options);

        Assert.Contains(ElementContentDiscriminators.Task, wire, StringComparison.Ordinal);
        Assert.Contains("\"done\":true", wire, StringComparison.Ordinal);
        var round = JsonSerializer.Deserialize<MindmapDocument>(wire, MindmapJson.Options)!;
        Assert.Equal("do it", Assert.IsType<TaskContent>(round.Elements[0].Content).Text);
    }

    // ---- Plumbing ----------------------------------------------------------------------------

    private static Stream Body(string json) => new MemoryStream(Encoding.UTF8.GetBytes(json));

    private static T Parse<T>(string body) => JsonSerializer.Deserialize<T>(body, MindmapJson.Options)!;

    private sealed record Response(int Status, string Body);

    private static async Task<Response> Execute(IResult result)
    {
        var services = new ServiceCollection();
        services.AddLogging();

        await using var provider = services.BuildServiceProvider();
        using var body = new MemoryStream();
        var context = new DefaultHttpContext { RequestServices = provider };
        context.Response.Body = body;

        await result.ExecuteAsync(context);

        return new Response(context.Response.StatusCode, Encoding.UTF8.GetString(body.ToArray()));
    }
}
