using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>Tool dispatcher double that records calls and produces scripted results.</summary>
internal sealed class FakeToolDispatcher : IToolDispatcher
{
    private readonly Func<ToolCallRequest, ToolCallResult> _resultFactory;

    public List<(ToolCallRequest Request, ToolDispatchScope? Scope)> Calls { get; } = new();

    public FakeToolDispatcher(Func<ToolCallRequest, ToolCallResult>? resultFactory = null)
        => _resultFactory = resultFactory ?? (request => new ToolCallResult(request.Id, request.Name, "dispatched"));

    public Task<ToolCallResult> DispatchAsync(ToolCallRequest request, ToolDispatchScope? scope = null, CancellationToken ct = default)
    {
        Calls.Add((request, scope));
        return Task.FromResult(_resultFactory(request));
    }
}
