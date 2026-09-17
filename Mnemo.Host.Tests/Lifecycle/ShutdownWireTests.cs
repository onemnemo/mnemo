using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Mnemo.Host.Lifecycle;
using Xunit;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// The closing handler and the SPA agree on one event name, and nothing but this binds them: a
/// rename on either side takes the exit prompt and the closing save away without a compile
/// error anywhere. The client's constant is read out of its source so the two sides are held to
/// each other rather than each to its own copy.
/// </summary>
public sealed class ShutdownWireTests
{
    private const string ClientTypesFile = "mnemo-web/src/events/types.ts";

    [Fact]
    public void The_host_publishes_the_name_the_client_keys_its_handshake_on()
    {
        Assert.Equal("shutdown", ShutdownGate.EventName);
    }

    [Fact]
    public void The_client_constant_reads_the_same_string()
    {
        var source = File.ReadAllText(ClientTypesPath());
        var match = Regex.Match(source, "Shutdown:\\s*\"(?<name>[^\"]+)\"");

        Assert.True(match.Success, $"{ClientTypesFile} no longer declares EventType.Shutdown.");
        Assert.Equal(ShutdownGate.EventName, match.Groups["name"].Value);
    }

    private static string ClientTypesPath([CallerFilePath] string testFile = "")
    {
        var directory = Path.GetDirectoryName(testFile);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory, ClientTypesFile);
            if (File.Exists(candidate))
                return candidate;
            directory = Path.GetDirectoryName(directory);
        }

        throw new FileNotFoundException($"Could not find {ClientTypesFile} above {testFile}.");
    }
}
