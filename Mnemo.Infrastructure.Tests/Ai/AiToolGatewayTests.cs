using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.AI;

namespace Mnemo.Infrastructure.Tests.Ai;

public class AiToolGatewayTests
{
    private static SkillToolDefinition ManifestTool(string name, string description)
        => new()
        {
            Name = name,
            Description = description,
            Parameters = JsonSerializer.SerializeToElement(new { type = "object" }),
            Enabled = true,
        };

    [Fact]
    public async Task GetToolDefinitionsAsync_loads_host_first_then_maps_manifest_tools_verbatim()
    {
        var host = new FakeToolHost();
        var registry = new FakeSkillRegistry(host, ("skill-a", ManifestTool("do_thing", "does a thing")));
        var gateway = new AiToolGateway(registry, new FakeToolDispatcher(), host);

        var definitions = await gateway.GetToolDefinitionsAsync();

        // Manifests must be loaded before the registry is read.
        Assert.True(host.EnsureLoadedCallCount >= 1);
        Assert.True(registry.HostLoadedAtQueryTime);

        var def = Assert.Single(definitions);
        Assert.Equal("do_thing", def.Name);
        Assert.Equal("does a thing", def.Description);
        Assert.Equal("object", def.ParametersSchema.GetProperty("type").GetString());
    }

    [Fact]
    public async Task DispatchAsync_passes_call_and_scope_through_and_returns_dispatcher_result()
    {
        var dispatcher = new FakeToolDispatcher(request => new ToolCallResult(request.Id, request.Name, "result-body"));
        var gateway = new AiToolGateway(new FakeSkillRegistry(), dispatcher, new FakeToolHost());
        var call = new ToolCallRequest("id-1", "tool", "{}");
        var scope = new ToolDispatchScope("conv-9");

        var result = await gateway.DispatchAsync(call, scope);

        var recorded = Assert.Single(dispatcher.Calls);
        Assert.Same(call, recorded.Request);
        Assert.Same(scope, recorded.Scope);
        Assert.Equal("result-body", result.Content);
    }
}
