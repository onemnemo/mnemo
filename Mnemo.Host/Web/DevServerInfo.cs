using System.Text.Json;

namespace Mnemo.Host.Web;

/// <summary>
/// In dev mode the page is served by Vite, so the templated-index token channel
/// does not exist. The host instead writes {port, token} to mnemo-web/.dev/api.json
/// (gitignored); the Vite proxy reads it per request and injects the Authorization
/// header server-side, keeping the SPA code identical in both modes.
/// </summary>
public static class DevServerInfo
{
    public static string? Write(int apiPort, string bearerToken)
    {
        var path = ResolvePath();
        if (path is null)
            return null;

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(new { port = apiPort, token = bearerToken }));
        return path;
    }

    private static string? ResolvePath()
    {
        var overridePath = Environment.GetEnvironmentVariable("MNEMO_DEV_INFO_FILE");
        if (!string.IsNullOrWhiteSpace(overridePath))
            return Path.GetFullPath(overridePath);

        // Dev builds run from <repo>/Mnemo.Host/bin/...; walk up to the repo root.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "MnemoApp.sln")))
                return Path.Combine(dir.FullName, "mnemo-web", ".dev", "api.json");

            dir = dir.Parent;
        }

        return null;
    }
}
