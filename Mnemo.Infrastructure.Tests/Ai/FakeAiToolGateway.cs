using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>
/// Tool gateway double for orchestrator tests: returns a fixed definition set, produces
/// scripted results, and records every dispatched call with its scope.
/// </summary>
internal sealed class FakeAiToolGateway : IAiToolGateway
{
    private readonly IReadOnlyList<ChatToolDefinition> _definitions;
    private readonly Func<ToolCallRequest, ToolCallResult> _resultFactory;

    public int GetToolDefinitionsCallCount { get; private set; }
    public List<(ToolCallRequest Call, ToolDispatchScope? Scope)> Dispatched { get; } = new();

    public FakeAiToolGateway(
        IReadOnlyList<ChatToolDefinition>? definitions = null,
        Func<ToolCallRequest, ToolCallResult>? resultFactory = null)
    {
        _definitions = definitions ?? Array.Empty<ChatToolDefinition>();
        _resultFactory = resultFactory ?? (call => new ToolCallResult(call.Id, call.Name, "ok"));
    }

    public Task<IReadOnlyList<ChatToolDefinition>> GetToolDefinitionsAsync(CancellationToken ct = default)
    {
        GetToolDefinitionsCallCount++;
        return Task.FromResult(_definitions);
    }

    public Task<ToolCallResult> DispatchAsync(ToolCallRequest call, ToolDispatchScope? scope = null, CancellationToken ct = default)
    {
        Dispatched.Add((call, scope));
        return Task.FromResult(_resultFactory(call));
    }
}
