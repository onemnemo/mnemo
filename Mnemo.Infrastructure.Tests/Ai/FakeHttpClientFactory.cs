using System.Net.Http;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>Hands out clients over a shared handler; the handler outlives each client so its scripted queue persists.</summary>
internal sealed class FakeHttpClientFactory : IHttpClientFactory
{
    private readonly HttpMessageHandler _handler;

    public FakeHttpClientFactory(HttpMessageHandler handler) => _handler = handler;

    public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
}
