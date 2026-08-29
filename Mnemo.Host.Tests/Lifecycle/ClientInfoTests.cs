using Mnemo.Host.Lifecycle;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// Checks that client metadata cannot inject extra log records or exceed the field limit.
/// </summary>
public sealed class ClientInfoTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AsLogValue_ReportsAnUnknownClient_WhenNothingUsableWasSent(string? userAgent)
    {
        Assert.Equal("unknown", LifecycleEndpoints.AsLogValue(userAgent));
    }

    [Fact]
    public void AsLogValue_KeepsARealUserAgentIntact()
    {
        const string real = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

        Assert.Equal(real, LifecycleEndpoints.AsLogValue(real));
    }

    [Theory]
    [InlineData("one\ntwo")]
    [InlineData("one\r\ntwo")]
    [InlineData("one\ttwo")]
    public void AsLogValue_FlattensControlCharacters_SoAValueCannotForgeALogRecord(string userAgent)
    {
        var line = LifecycleEndpoints.AsLogValue(userAgent);

        Assert.DoesNotContain("\n", line, StringComparison.Ordinal);
        Assert.DoesNotContain("\r", line, StringComparison.Ordinal);
        Assert.DoesNotContain("\t", line, StringComparison.Ordinal);
        Assert.StartsWith("one", line, StringComparison.Ordinal);
        Assert.EndsWith("two", line, StringComparison.Ordinal);
    }

    [Fact]
    public void AsLogValue_DropsWhatWillNotFit()
    {
        var line = LifecycleEndpoints.AsLogValue(new string('a', 5000));

        Assert.Equal(256, line.Length);
    }
}
