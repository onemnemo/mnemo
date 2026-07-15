using System;
using System.Collections.Generic;
namespace Mnemo.Core.Models;

/// <summary>Root document for persisted Atlas (chat module) sessions.</summary>
public sealed class ChatModuleHistoryDocument
{
    public int Version { get; set; } = 1;

    public List<ChatModulePersistedConversation> Conversations { get; set; } = new();
}

/// <summary>One chat thread in the module sidebar.</summary>
public sealed class ChatModulePersistedConversation
{
    public string Id { get; set; } = string.Empty;

    public DateTime LastActivityUtc { get; set; }

    public string AssistantMode { get; set; } = "Normal";

    /// <summary>Kept for JSON backward-compat with old persisted data; no longer used.</summary>
    [Obsolete("ModelRoutingMode is no longer used; Atlas handles routing internally.")]
    public string? ModelRoutingMode { get; set; }

    /// <summary>Optional user-defined title for the sidebar; when null, title is derived from the first user message.</summary>
    public string? CustomTitle { get; set; }

    public List<ChatModulePersistedMessage> Messages { get; set; } = new();

    /// <summary>
    /// JSON-serialized <see cref="Mnemo.Core.Models.ConversationMemorySnapshot"/> for this conversation.
    /// Null when no memory has been accumulated yet (new or pre-memory conversations).
    /// </summary>
    public string? MemorySnapshotJson { get; set; }
}

/// <summary>Serializable chat bubble (no transient UI/streaming state).</summary>
public sealed class ChatModulePersistedMessage
{
    public string Content { get; set; } = string.Empty;

    public bool IsUser { get; set; }

    public DateTime TimestampUtc { get; set; }

    public List<string>? Suggestions { get; set; }

    public List<string>? Sources { get; set; }

    public List<ChatModulePersistedAttachment>? Attachments { get; set; }

    // Assistant-only: thought process / tool thread (restored when reopening a conversation)
    public string? Thoughts { get; set; }

    public int ThoughtsCount { get; set; }

    public string? ProcessHeaderText { get; set; }

    public string? ElapsedText { get; set; }

    /// <summary>Collapsed-trace summary suffix, e.g. "used 2 tools".</summary>
    public string? ProcessSummaryText { get; set; }

    public bool? ProcessThreadExpanded { get; set; }

    /// <summary>Reader feedback: 0 none, 1 up, 2 down.</summary>
    public int Feedback { get; set; }

    public List<ChatModulePersistedProcessStep>? ProcessSteps { get; set; }
}

/// <summary>One step in the assistant process thread (routing, model, tools, …).</summary>
public sealed class ChatModulePersistedProcessStep
{
    public string Label { get; set; } = string.Empty;

    public string? Detail { get; set; }

    /// <summary>Quoted mid-turn prose for a Narration step; null for other kinds.</summary>
    public string? Narration { get; set; }

    /// <summary>Phase kind name for reload: Routing, Model, Generating, Tool, Continuing, or Narration.</summary>
    public string PhaseKind { get; set; } = "Routing";

    public bool IsComplete { get; set; } = true;

    public List<ChatModulePersistedToolCallEntry>? ToolCalls { get; set; }
}

/// <summary>One tool invocation shown under a process step.</summary>
public sealed class ChatModulePersistedToolCallEntry
{
    public string Name { get; set; } = string.Empty;

    public string Arguments { get; set; } = string.Empty;

    public string Result { get; set; } = string.Empty;

    public string Summary { get; set; } = string.Empty;
}

public sealed class ChatModulePersistedAttachment
{
    public string Path { get; set; } = string.Empty;

    public ChatAttachmentKind Kind { get; set; }

    public string? DisplayName { get; set; }
}
