using System.Text.Json;

namespace Mnemo.Core.Models.Ai;

/// <summary>A tool the model may call, in provider-neutral form.</summary>
/// <param name="Name">Wire name the model calls (matches the skill manifest).</param>
/// <param name="Description">What the tool does, written for the model.</param>
/// <param name="ParametersSchema">JSON Schema for the arguments, passed through verbatim from the manifest.</param>
public sealed record ChatToolDefinition(string Name, string Description, JsonElement ParametersSchema);
