using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;
using Mnemo.Infrastructure.Services.AI;

namespace Mnemo.Infrastructure.Tests.Ai;

public class AIOrchestratorTests
{
    private static readonly IReadOnlyList<ConversationTurn> NoHistory = Array.Empty<ConversationTurn>();

    private static AIOrchestrator NewOrchestrator(
        IModelRouter router,
        IAiToolGateway? gateway = null,
        ISettingsService? settings = null,
        ILoggerService? logger = null)
        => new(router, gateway ?? new FakeAiToolGateway(), settings ?? new FakeSettingsService(), logger ?? new TestLogger());

    private static ChatToolDefinition Def(string name)
        => new(name, name + " description", JsonSerializer.SerializeToElement(new { type = "object" }));

    private static async Task<List<string>> CollectAsync(IAsyncEnumerable<string> stream)
    {
        var items = new List<string>();
        await foreach (var token in stream)
        {
            items.Add(token);
        }
        return items;
    }

    [Fact]
    public async Task Streaming_yields_content_deltas_not_cumulative_text()
    {
        var client = new ScriptedChatModelClient().Enqueue(
            new ChatStreamDelta.Content("Hel"),
            new ChatStreamDelta.Content("lo"),
            new ChatStreamDelta.Content("!"),
            new ChatStreamDelta.Finish(ChatFinishReason.Stop));
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client));

        var tokens = await CollectAsync(orchestrator.PromptStreamingWithHistoryAsync("sys", NoHistory, "hi"));

        Assert.Equal(new[] { "Hel", "lo", "!" }, tokens);
    }

    [Fact]
    public async Task Reasoning_callback_receives_cumulative_text()
    {
        var client = new ScriptedChatModelClient().Enqueue(
            new ChatStreamDelta.Reasoning("a"),
            new ChatStreamDelta.Reasoning("b"),
            new ChatStreamDelta.Content("x"),
            new ChatStreamDelta.Finish(ChatFinishReason.Stop));
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client));

        var reasoning = new List<string>();
        var tokens = new List<string>();
        await foreach (var token in orchestrator.PromptStreamingWithHistoryAsync(
            "sys", NoHistory, "hi", onAssistantReasoningUpdate: reasoning.Add))
        {
            tokens.Add(token);
        }

        Assert.Equal(new[] { "a", "ab" }, reasoning);
        Assert.Equal(new[] { "x" }, tokens);
    }

    [Fact]
    public async Task Tool_call_round_trip_feeds_result_back_and_reports_status()
    {
        var call = new ToolCallRequest("call-1", "get_time", "{\"tz\":\"utc\"}");
        var client = new ScriptedChatModelClient()
            .Enqueue(new ChatStreamDelta.ToolCall(call), new ChatStreamDelta.Finish(ChatFinishReason.ToolCalls))
            .Enqueue(new ChatStreamDelta.Content("It is noon."), new ChatStreamDelta.Finish(ChatFinishReason.Stop));
        var gateway = new FakeAiToolGateway(
            definitions: new[] { Def("get_time") },
            resultFactory: c => new ToolCallResult(c.Id, c.Name, "12:00"));
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client), gateway);

        var toolEvents = new List<ChatToolCall>();
        var progress = new CapturingProgress();
        var tokens = new List<string>();
        await foreach (var token in orchestrator.PromptStreamingWithHistoryAsync(
            "sys", NoHistory, "what time is it?",
            pipelineStatus: progress,
            conversationRoutingKey: "conv-1",
            onToolCall: toolEvents.Add))
        {
            tokens.Add(token);
        }

        Assert.Equal("It is noon.", string.Concat(tokens));

        var dispatched = Assert.Single(gateway.Dispatched);
        Assert.Equal("call-1", dispatched.Call.Id);
        Assert.Equal("conv-1", dispatched.Scope?.ConversationRoutingKey);

        Assert.Equal(2, toolEvents.Count);
        Assert.Equal(ChatToolCallStage.Running, toolEvents[0].Stage);
        Assert.Equal("call-1", toolEvents[0].ToolCallId);
        Assert.Equal(ChatToolCallStage.Completed, toolEvents[1].Stage);
        Assert.Equal("call-1", toolEvents[1].ToolCallId);
        Assert.Equal("12:00", toolEvents[1].ResultContent);

        Assert.Equal(2, client.Requests.Count);
        var round2 = client.Requests[1].Messages;
        var toolResult = round2[^1];
        Assert.Equal(ChatMessageRole.Tool, toolResult.Role);
        Assert.Equal("12:00", toolResult.Content);
        Assert.Equal("call-1", toolResult.ToolCallId);
        var assistant = round2[^2];
        Assert.Equal(ChatMessageRole.Assistant, assistant.Role);
        Assert.NotNull(assistant.ToolCalls);
        Assert.Equal("call-1", assistant.ToolCalls![0].Id);

        Assert.Contains(ChatPipelineStatusKeys.RunningTool("get_time"), progress.Reports);
        Assert.Contains(ChatPipelineStatusKeys.ContinuingAfterTool, progress.Reports);
    }

    [Fact]
    public async Task Tool_call_loop_stops_at_round_cap()
    {
        var call = new ToolCallRequest("c", "loop_tool", "{}");
        var client = new ScriptedChatModelClient
        {
            AlwaysEmit = new ChatStreamDelta[]
            {
                new ChatStreamDelta.ToolCall(call),
                new ChatStreamDelta.Finish(ChatFinishReason.ToolCalls),
            },
        };
        var gateway = new FakeAiToolGateway(definitions: new[] { Def("loop_tool") });
        var logger = new TestLogger();
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client), gateway, logger: logger);

        var tokens = await CollectAsync(orchestrator.PromptStreamingWithHistoryAsync("sys", NoHistory, "go"));

        Assert.Empty(tokens);
        Assert.Equal(6, gateway.Dispatched.Count);
        Assert.Contains(logger.Entries, e => e.Level == LogLevel.Warning && e.Category == "AIOrchestrator");
    }

    [Fact]
    public async Task Cancellation_mid_stream_surfaces_and_stops_producer()
    {
        var client = new ScriptedChatModelClient { InfiniteSlowStream = true };
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client));

        using var cts = new CancellationTokenSource();
        var received = new List<string>();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            await foreach (var token in orchestrator.PromptStreamingWithHistoryAsync(
                "sys", NoHistory, "hi", cts.Token))
            {
                received.Add(token);
                if (received.Count >= 3)
                {
                    cts.Cancel();
                }
            }
        });

        // Stopped promptly at the cancellation point rather than running away.
        Assert.InRange(received.Count, 1, 6);
    }

    [Fact]
    public async Task AgentMode_off_sends_no_tools_even_when_gateway_has_definitions()
    {
        var client = new ScriptedChatModelClient().Enqueue(
            new ChatStreamDelta.Content("hi"),
            new ChatStreamDelta.Finish(ChatFinishReason.Stop));
        var gateway = new FakeAiToolGateway(definitions: new[] { Def("some_tool") });
        var settings = new FakeSettingsService().Set("AI.AgentMode", false);
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client), gateway, settings);

        await CollectAsync(orchestrator.PromptStreamingWithHistoryAsync("sys", NoHistory, "hi"));

        Assert.Null(client.Requests[0].Tools);
        Assert.Equal(0, gateway.GetToolDefinitionsCallCount);
    }

    [Fact]
    public async Task Unavailable_route_yields_empty_stream_and_logs_warning()
    {
        var logger = new TestLogger();
        var orchestrator = NewOrchestrator(FakeModelRouter.Unavailable(AiRouteStatus.MissingApiKey), logger: logger);

        var tokens = await CollectAsync(orchestrator.PromptStreamingWithHistoryAsync("sys", NoHistory, "hi"));

        Assert.Empty(tokens);
        Assert.Contains(logger.Entries, e => e.Level == LogLevel.Warning && e.Category == "AIOrchestrator");
    }

    [Fact]
    public async Task Provider_failure_mid_stream_ends_gracefully_and_logs_error()
    {
        var client = new ScriptedChatModelClient
        {
            ThrowAfterSequence = new AiClientException(AiClientErrorKind.Network, "connection reset"),
        };
        client.Enqueue(new ChatStreamDelta.Content("par"), new ChatStreamDelta.Content("tial"));
        var logger = new TestLogger();
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client), logger: logger);

        var tokens = await CollectAsync(orchestrator.PromptStreamingWithHistoryAsync("sys", NoHistory, "hi"));

        Assert.Equal(new[] { "par", "tial" }, tokens);
        Assert.Contains(logger.Entries, e => e.Level == LogLevel.Error && e.Category == "AIOrchestrator");
    }

    [Fact]
    public async Task PromptAsync_concatenates_content_on_success()
    {
        var client = new ScriptedChatModelClient().Enqueue(
            new ChatStreamDelta.Content("Hello "),
            new ChatStreamDelta.Content("world"),
            new ChatStreamDelta.Finish(ChatFinishReason.Stop));
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client));

        var result = await orchestrator.PromptAsync("sys", "hi");

        Assert.True(result.IsSuccess);
        Assert.Equal("Hello world", result.Value);
        Assert.Null(client.Requests[0].Tools);
        Assert.Equal(ChatMessageRole.System, client.Requests[0].Messages[0].Role);
        Assert.Equal(ChatMessageRole.User, client.Requests[0].Messages[1].Role);
    }

    [Fact]
    public async Task PromptAsync_returns_failure_on_provider_error()
    {
        var client = new ScriptedChatModelClient
        {
            ThrowAfterSequence = new AiClientException(AiClientErrorKind.RateLimited, "slow down"),
        };
        client.Enqueue(new ChatStreamDelta.Content("partial"));
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client));

        var result = await orchestrator.PromptAsync("sys", "hi");

        Assert.False(result.IsSuccess);
        Assert.Contains("slow down", result.ErrorMessage);
    }

    [Fact]
    public async Task PromptAsync_returns_failure_when_model_produces_no_content()
    {
        var client = new ScriptedChatModelClient().Enqueue(new ChatStreamDelta.Finish(ChatFinishReason.Stop));
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client));

        var result = await orchestrator.PromptAsync("sys", "hi");

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task PromptAsync_returns_failure_when_no_model_available()
    {
        var orchestrator = NewOrchestrator(FakeModelRouter.Unavailable(AiRouteStatus.NoBinding));

        var result = await orchestrator.PromptAsync("sys", "hi");

        Assert.False(result.IsSuccess);
        Assert.Contains("NoBinding", result.ErrorMessage);
    }

    [Fact]
    public async Task PromptStructuredAsync_sets_response_schema_from_json_string()
    {
        var client = new ScriptedChatModelClient().Enqueue(
            new ChatStreamDelta.Content("{}"),
            new ChatStreamDelta.Finish(ChatFinishReason.Stop));
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client));

        var result = await orchestrator.PromptStructuredAsync("sys", "hi", "{\"type\":\"object\"}");

        Assert.True(result.IsSuccess);
        var schema = client.Requests[0].ResponseSchema;
        Assert.NotNull(schema);
        Assert.Equal("response", schema!.Name);
        Assert.Equal(JsonValueKind.Object, schema.Schema.ValueKind);
        Assert.Equal("object", schema.Schema.GetProperty("type").GetString());
    }

    [Fact]
    public async Task PromptStructuredAsync_sets_response_schema_from_poco()
    {
        var client = new ScriptedChatModelClient().Enqueue(
            new ChatStreamDelta.Content("{}"),
            new ChatStreamDelta.Finish(ChatFinishReason.Stop));
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client));

        var result = await orchestrator.PromptStructuredAsync("sys", "hi", new { type = "object", title = "Card" });

        Assert.True(result.IsSuccess);
        var schema = client.Requests[0].ResponseSchema;
        Assert.NotNull(schema);
        Assert.Equal("Card", schema!.Schema.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Streaming_builds_system_history_then_user_messages()
    {
        var client = new ScriptedChatModelClient().Enqueue(
            new ChatStreamDelta.Content("ok"),
            new ChatStreamDelta.Finish(ChatFinishReason.Stop));
        var orchestrator = NewOrchestrator(FakeModelRouter.Available(client));
        var history = new[]
        {
            new ConversationTurn(ConversationRole.User, "earlier question"),
            new ConversationTurn(ConversationRole.Assistant, "earlier answer"),
        };

        await CollectAsync(orchestrator.PromptStreamingWithHistoryAsync("system text", history, "current question"));

        var messages = client.Requests[0].Messages;
        Assert.Equal(4, messages.Count);
        Assert.Equal(ChatMessageRole.System, messages[0].Role);
        Assert.Equal("system text", messages[0].Content);
        Assert.Equal(ChatMessageRole.User, messages[1].Role);
        Assert.Equal("earlier question", messages[1].Content);
        Assert.Equal(ChatMessageRole.Assistant, messages[2].Role);
        Assert.Equal("earlier answer", messages[2].Content);
        Assert.Equal(ChatMessageRole.User, messages[3].Role);
        Assert.Equal("current question", messages[3].Content);
    }
}
