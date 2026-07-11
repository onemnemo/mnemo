namespace Mnemo.Core.Models.Ai;

/// <summary>Why the model stopped generating.</summary>
public enum ChatFinishReason
{
    /// <summary>Natural end of the answer.</summary>
    Stop = 0,

    /// <summary>The model stopped to request tool calls.</summary>
    ToolCalls = 1,

    /// <summary>The output-token cap was hit; the answer may be truncated.</summary>
    Length = 2,

    /// <summary>The provider filtered the content.</summary>
    ContentFilter = 3,

    /// <summary>A provider-specific reason not covered above.</summary>
    Other = 4,
}
