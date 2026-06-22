namespace Mnemo.UI.Mcp;

/// <summary>Configuration for the in-process MCP tool server.</summary>
public sealed class MnemoMcpOptions
{
    /// <summary>Whether to start the MCP server at all. Default: true.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Loopback port for the Streamable-HTTP MCP endpoint. Default: 48200.</summary>
    public int Port { get; set; } = 48200;

    /// <summary>
    /// Optional shared bearer token. When non-empty, all requests must supply
    /// <c>Authorization: Bearer &lt;token&gt;</c>. Leave empty for loopback-only dev use.
    /// </summary>
    public string? BearerToken { get; set; }
}
