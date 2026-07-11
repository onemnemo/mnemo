namespace Mnemo.Core.Services.Ai;

/// <summary>A chat client bound to a concrete model id, ready to stream.</summary>
/// <param name="Client">The provider client to call.</param>
/// <param name="ModelId">The provider model id to run on <paramref name="Client"/>.</param>
public sealed record ChatModelBinding(IChatModelClient Client, string ModelId);
