namespace Mnemo.Core.Services.Ai;

/// <summary>A text client bound to a concrete model id, ready to complete.</summary>
/// <param name="Client">The provider client to call.</param>
/// <param name="ModelId">The provider model id to run on <paramref name="Client"/>.</param>
public sealed record TextModelBinding(ITextModelClient Client, string ModelId);
