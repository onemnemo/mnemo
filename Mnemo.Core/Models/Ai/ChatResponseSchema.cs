using System.Text.Json;

namespace Mnemo.Core.Models.Ai;

/// <summary>A named JSON schema the model's output must conform to (native structured outputs).</summary>
/// <param name="Name">Schema name reported to the provider.</param>
/// <param name="Schema">The JSON Schema for the response body.</param>
/// <param name="Strict">Whether the provider must enforce the schema strictly.</param>
public sealed record ChatResponseSchema(string Name, JsonElement Schema, bool Strict = true);
