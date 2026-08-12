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
/// The arrange endpoint against a real store and the real layout providers.
/// <para>
/// An arrange is an edit, not a mode: it answers in the same shape <c>/ops</c> does, it is one entry
/// on the undo stack, and asking for a named arrangement also chooses it, so the next arrange with
/// nothing named lays the map out the same way again. None of that is visible from reading the
/// handler, and all of it is what makes layout something you ask for rather than something that
/// happens to you after every keystroke.
/// </para>
/// </summary>
public sealed class MindmapArrangeHttpTests
{
    [Fact]
    public async Task ArrangingMovesTheNodesAndAnswersLikeAnEdit()
    {
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);

        var response = await Execute(await MindmapEndpoints.ArrangeAsync(
            map.Id, Body($$"""{ "expectedRevision": {{map.Revision}} }"""), h.Service, h.Layout));

        Assert.Equal(StatusCodes.Status200OK, response.Status);
        var body = Parse<MindmapOpsResultDto>(response.Body);
        Assert.True(body.Revision > map.Revision);

        var stored = (await h.Service.GetAsync(map.Id)).Value!;
        var kids = stored.Elements.Where(e => e.Id != Root(stored).Id).ToList();
        // A layout that placed everything on the origin is a layout that did not run.
        Assert.Contains(kids, kid => kid.X != 0 || kid.Y != 0);
    }

    [Fact]
    public async Task AskingForAnArrangementAlsoChoosesIt()
    {
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);

        await MindmapEndpoints.ArrangeAsync(
            map.Id,
            Body($$"""{ "expectedRevision": {{map.Revision}}, "algorithm": "treeDown" }"""),
            h.Service,
            h.Layout);

        var stored = (await h.Service.GetAsync(map.Id)).Value!;
        var cluster = Assert.Single(stored.Clusters);
        Assert.Equal(Root(stored).Id, cluster.RootId);
        Assert.Equal(MindmapLayoutAlgorithms.TreeDown, cluster.LayoutAlgorithm);
    }

    [Fact]
    public async Task TheChoiceAndTheMovesItCausedAreOneStep()
    {
        // The whole reason the choice is written by the arrange rather than sent as a separate op: two
        // steps would mean an undo that put the nodes back while leaving the map claiming an
        // arrangement it is no longer in.
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);

        var body = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ArrangeAsync(
            map.Id,
            Body($$"""{ "expectedRevision": {{map.Revision}}, "algorithm": "radial" }"""),
            h.Service,
            h.Layout))).Body);

        Assert.Equal(map.Revision + 1, body.Revision);
    }

    [Fact]
    public async Task ArrangingIntoTheShapeItIsAlreadyInIsNotAnEdit()
    {
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);

        var first = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ArrangeAsync(
            map.Id,
            Body($$"""{ "expectedRevision": {{map.Revision}}, "algorithm": "treeRight" }"""),
            h.Service,
            h.Layout))).Body);

        var again = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ArrangeAsync(
            map.Id,
            Body($$"""{ "expectedRevision": {{first.Revision}}, "algorithm": "treeRight" }"""),
            h.Service,
            h.Layout))).Body);

        // Nothing moved and nothing changed its mind, so there is nothing to push onto an undo stack.
        Assert.Equal(first.Revision, again.Revision);
    }

    [Fact]
    public async Task ArrangingDoesNotPinTheNodesItMoved()
    {
        // Arrange writes coordinates the same way a drag does, so without saying otherwise it would
        // claim every one of them for the author and leave the map frozen against the next arrange.
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);

        await MindmapEndpoints.ArrangeAsync(
            map.Id, Body($$"""{ "expectedRevision": {{map.Revision}} }"""), h.Service, h.Layout);

        var stored = (await h.Service.GetAsync(map.Id)).Value!;
        Assert.All(stored.Elements, element => Assert.False(element.Pinned));
    }

    [Fact]
    public async Task APinnedNodeSitsOutTheArrange()
    {
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);
        var pinned = map.Elements.First(e => e.Id != Root(map).Id);

        var moved = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [
              { "op": "move", "id": "{{pinned.Id}}", "xy": [777, 555] }
            ] }
            """), h.Service))).Body);

        await MindmapEndpoints.ArrangeAsync(
            map.Id, Body($$"""{ "expectedRevision": {{moved.Revision}} }"""), h.Service, h.Layout);

        var stored = (await h.Service.GetAsync(map.Id)).Value!;
        var after = stored.Elements.Single(e => e.Id == pinned.Id);
        Assert.Equal((777, 555), (after.X, after.Y));
        Assert.True(after.Pinned);

        // And the rest of the map still got laid out around it.
        Assert.Contains(stored.Elements, e => e.Id != pinned.Id && (e.X != 0 || e.Y != 0));
    }

    [Fact]
    public async Task AMapWideStyleChangeComesBackWithADeltaThatUndoesIt()
    {
        // The map's own settings hang off the document rather than off any element, so the delta the
        // undo stack is built from would be empty for them unless it carries the canvas. That is the
        // difference between choosing a background being undoable and the undo entry doing nothing.
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);

        var body = Parse<MindmapOpsResultDto>((await Execute(await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [
              { "op": "layout", "background": "grid", "template": "blueprint" }
            ] }
            """), h.Service))).Body);

        Assert.Equal(CanvasBackground.Grid, body.Redo!.Canvas!.Background);
        Assert.Equal("blueprint", body.Redo.Canvas.DefaultTemplateId);

        await h.Service.RestoreAsync(map.Id, body.Revision, body.Undo!);

        var restored = (await h.Service.GetAsync(map.Id)).Value!;
        Assert.Equal(CanvasBackground.Dots, restored.Canvas.Background);
        Assert.Null(restored.Canvas.DefaultTemplateId);
    }

    [Fact]
    public async Task AStaleRevisionIsA409TheClientCanRebaseOn()
    {
        await using var h = new MindmapHostHarness();
        var map = await SeededMap(h);

        var response = await Execute(await MindmapEndpoints.ArrangeAsync(
            map.Id, Body($$"""{ "expectedRevision": {{map.Revision - 1}} }"""), h.Service, h.Layout));

        Assert.Equal(StatusCodes.Status409Conflict, response.Status);
    }

    // ---- Plumbing ----------------------------------------------------------------------------

    /// <summary>A root with three children, which every algorithm has something to say about.</summary>
    private static async Task<MindmapDocument> SeededMap(MindmapHostHarness h)
    {
        var map = (await h.Service.CreateAsync("M")).Value!;
        await MindmapEndpoints.ApplyOpsAsync(map.Id, Body($$"""
            { "expectedRevision": {{map.Revision}}, "ops": [
              { "op": "add", "nodes": [ { "ref": "r", "t": "Root",
                  "c": [ { "t": "One" }, { "t": "Two" }, { "t": "Three" } ] } ] }
            ] }
            """), h.Service);
        return (await h.Service.GetAsync(map.Id)).Value!;
    }

    private static MindmapElement Root(MindmapDocument document)
    {
        var parented = document.Edges.Where(e => e.Kind == EdgeKind.Hierarchy).Select(e => e.ToId).ToHashSet();
        return document.Elements.First(e => e.Kind == ElementKind.Node && !parented.Contains(e.Id));
    }

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
