using System;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models.Ai;
using Mnemo.Infrastructure.Services.AI;

namespace Mnemo.Infrastructure.Tests.Ai;

public class OpenRouterKeyValidatorTests
{
    private const string ValidateUrl = "https://openrouter.ai/api/v1/auth/key";

    private static OpenRouterKeyValidator NewValidator(FakeHttpMessageHandler handler, TestLogger? logger = null)
        => new(new FakeHttpClientFactory(handler), logger ?? new TestLogger());

    // 1. Blank/missing key: invalid, no HTTP call at all.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Blank_or_missing_key_is_invalid_without_sending(string? key)
    {
        var handler = new FakeHttpMessageHandler();
        var validator = NewValidator(handler);

        var result = await validator.ValidateAsync(key!);

        Assert.False(result.IsValid);
        Assert.Equal(AiClientErrorKind.InvalidApiKey, result.FailureKind);
        Assert.Empty(handler.Requests);
    }

    // 2. Valid key, credits nested under "data".
    [Fact]
    public async Task Valid_key_maps_credits_from_data_object()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(
            HttpStatusCode.OK, """{"data":{"usage":1.23,"limit":10}}""", "application/json");
        var validator = NewValidator(handler);

        var result = await validator.ValidateAsync("sk-test-key");

        Assert.True(result.IsValid);
        Assert.Null(result.FailureKind);
        Assert.Equal(1.23m, result.CreditsUsed);
        Assert.Equal(10m, result.CreditsLimit);
    }

    // 3. Missing limit maps to null, not a failure.
    [Fact]
    public async Task Missing_limit_maps_to_null_credits_limit()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(
            HttpStatusCode.OK, """{"data":{"usage":4.5}}""", "application/json");
        var validator = NewValidator(handler);

        var result = await validator.ValidateAsync("sk-test-key");

        Assert.True(result.IsValid);
        Assert.Equal(4.5m, result.CreditsUsed);
        Assert.Null(result.CreditsLimit);
    }

    // 4. Root-level usage/limit (no "data" wrapper) still parses.
    [Fact]
    public async Task Root_level_usage_and_limit_are_parsed()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(
            HttpStatusCode.OK, """{"usage":2,"limit":50}""", "application/json");
        var validator = NewValidator(handler);

        var result = await validator.ValidateAsync("sk-test-key");

        Assert.True(result.IsValid);
        Assert.Equal(2m, result.CreditsUsed);
        Assert.Equal(50m, result.CreditsLimit);
    }

    [Fact]
    public async Task Status_401_maps_to_invalid_api_key()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(
            HttpStatusCode.Unauthorized, """{"error":"nope"}""", "application/json");
        var validator = NewValidator(handler);

        var result = await validator.ValidateAsync("sk-test-key");

        Assert.False(result.IsValid);
        Assert.Equal(AiClientErrorKind.InvalidApiKey, result.FailureKind);
    }

    [Fact]
    public async Task Status_429_maps_to_rate_limited()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.TooManyRequests, "{}", "application/json");
        var validator = NewValidator(handler);

        var result = await validator.ValidateAsync("sk-test-key");

        Assert.False(result.IsValid);
        Assert.Equal(AiClientErrorKind.RateLimited, result.FailureKind);
    }

    [Fact]
    public async Task Transport_failure_maps_to_network()
    {
        var handler = new FakeHttpMessageHandler().EnqueueThrow(new HttpRequestException("connection refused"));
        var validator = NewValidator(handler);

        var result = await validator.ValidateAsync("sk-test-key");

        Assert.False(result.IsValid);
        Assert.Equal(AiClientErrorKind.Network, result.FailureKind);
    }

    // 5. Request shape: bearer header + correct URL.
    [Fact]
    public async Task Sends_bearer_header_and_correct_url()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(
            HttpStatusCode.OK, """{"data":{"usage":0}}""", "application/json");
        var validator = NewValidator(handler);

        await validator.ValidateAsync("sk-my-key");

        var recorded = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, recorded.Method);
        Assert.Equal(ValidateUrl, recorded.Uri!.ToString());
        Assert.Equal("Bearer sk-my-key", recorded.Header("Authorization"));
    }

    // 6. Failed validations log once, and never leak the key into the log.
    [Fact]
    public async Task Failed_validation_logs_single_warning_without_the_key()
    {
        var logger = new TestLogger();
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.Unauthorized, "{}", "application/json");
        var validator = NewValidator(handler, logger);

        await validator.ValidateAsync("sk-super-secret");

        var warning = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Warning, warning.Level);
        Assert.DoesNotContain("sk-super-secret", warning.Message);
    }

    [Fact]
    public async Task Successful_validation_logs_nothing()
    {
        var logger = new TestLogger();
        var handler = new FakeHttpMessageHandler().EnqueueResponse(
            HttpStatusCode.OK, """{"data":{"usage":0}}""", "application/json");
        var validator = NewValidator(handler, logger);

        await validator.ValidateAsync("sk-test-key");

        Assert.Empty(logger.Entries);
    }
}
