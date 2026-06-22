using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.AI;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.UI.Mcp;

/// <summary>
/// Wraps a single skill-manifest tool as an <see cref="AIFunction"/> that routes
/// invocations through <see cref="IToolDispatcher"/>.
/// </summary>
internal sealed class DispatcherAIFunction : AIFunction
{
    private readonly SkillToolDefinition _def;
    private readonly IToolDispatcher _dispatcher;

    private static readonly JsonSerializerOptions _serializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public DispatcherAIFunction(SkillToolDefinition def, IToolDispatcher dispatcher)
    {
        _def = def;
        _dispatcher = dispatcher;
    }

    public override string Name => _def.Name;
    public override string Description => _def.Description;

    /// <summary>Returns the JSON schema verbatim from the skill manifest.</summary>
    public override JsonElement JsonSchema => _def.Parameters;

    protected override async ValueTask<object?> InvokeCoreAsync(
        AIFunctionArguments arguments,
        CancellationToken cancellationToken)
    {
        // Re-serialize the arguments dictionary back to JSON for IToolDispatcher.
        // Values arriving from MCP are already JsonElement, which serialises correctly.
        var argsDict = new Dictionary<string, object?>(arguments.Count, StringComparer.OrdinalIgnoreCase);
        foreach (var key in arguments.Keys)
            argsDict[key] = arguments[key];

        var argsJson = JsonSerializer.Serialize(argsDict, _serializerOptions);
        var callId = Guid.NewGuid().ToString("N")[..12];
        var req = new ToolCallRequest(callId, _def.Name, argsJson);
        var result = await _dispatcher.DispatchAsync(req, ct: cancellationToken).ConfigureAwait(false);
        return result.Content;
    }
}
