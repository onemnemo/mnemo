namespace Mnemo.Host;

/// <summary>
/// Launch options. <c>--dev [url]</c> points the window at the Vite dev server
/// (default http://localhost:5173/) and binds the API to a fixed dev port so the
/// Vite proxy has a stable target across host restarts; without it the host binds
/// an ephemeral port and serves the built SPA itself.
/// </summary>
public sealed record HostOptions(bool DevMode, string DevServerUrl, int DevApiPort, string? SpaRootOverride)
{
    public const int DefaultDevApiPort = 47210;

    public static HostOptions Parse(string[] args)
    {
        var devMode = false;
        var devServerUrl = "http://localhost:5173/";
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--dev")
            {
                devMode = true;
                if (i + 1 < args.Length && !args[i + 1].StartsWith('-'))
                    devServerUrl = args[++i];
            }
        }

        var devApiPort = DefaultDevApiPort;
        var portVariable = Environment.GetEnvironmentVariable("MNEMO_DEV_API_PORT");
        if (!string.IsNullOrWhiteSpace(portVariable) && int.TryParse(portVariable, out var parsedPort))
            devApiPort = parsedPort;

        return new HostOptions(devMode, devServerUrl, devApiPort, Environment.GetEnvironmentVariable("MNEMO_SPA_ROOT"));
    }
}
