using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// The assistant's single door to Mnemo's tools: exposes the enabled skill-manifest tools
/// as provider-neutral definitions and dispatches model-requested calls through the
/// in-process <see cref="IToolDispatcher"/>.
/// </summary>
public sealed class AiToolGateway : IAiToolGateway
{
    private readonly ISkillRegistry _skillRegistry;
    private readonly IToolDispatcher _toolDispatcher;
    private readonly IAiAssistantToolHost _toolHost;

    public AiToolGateway(ISkillRegistry skillRegistry, IToolDispatcher toolDispatcher, IAiAssistantToolHost toolHost)
    {
        _skillRegistry = skillRegistry;
        _toolDispatcher = toolDispatcher;
        _toolHost = toolHost;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ChatToolDefinition>> GetToolDefinitionsAsync(CancellationToken ct = default)
    {
        // Manifests load lazily; make sure the host has registered them before we enumerate.
        await _toolHost.EnsureLoadedAsync(ct).ConfigureAwait(false);

        var manifestTools = _skillRegistry.GetAllEnabledManifestTools();
        var definitions = new List<ChatToolDefinition>(manifestTools.Count);
        foreach (var (_, tool) in manifestTools)
        {
            // Schema is passed through verbatim from the manifest. The model sees exactly what the skill declared.
            definitions.Add(new ChatToolDefinition(tool.Name, tool.Description, tool.Parameters));
        }

        return definitions;
    }

    /// <inheritdoc />
    public Task<ToolCallResult> DispatchAsync(ToolCallRequest call, ToolDispatchScope? scope = null, CancellationToken ct = default)
        // The dispatcher already returns handler/argument failures as error-content results, so no extra guard is needed here.
        => _toolDispatcher.DispatchAsync(call, scope, ct);
}
