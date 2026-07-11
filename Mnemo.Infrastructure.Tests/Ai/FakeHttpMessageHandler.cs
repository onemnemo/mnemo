using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>
/// Message handler driven by a scripted queue of responders (one dequeued per send). It records
/// every outgoing request, reading the request content to a string at send time because the
/// content is disposed once the send returns and cannot be read afterwards.
/// </summary>
internal sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>> _responders = new();

    public List<RecordedRequest> Requests { get; } = new();

    public FakeHttpMessageHandler EnqueueResponse(
        HttpStatusCode status,
        string body,
        string contentType = "text/event-stream",
        Action<HttpResponseHeaders>? configureHeaders = null)
    {
        _responders.Enqueue((_, _) =>
        {
            var response = new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, contentType),
            };
            configureHeaders?.Invoke(response.Headers);
            return Task.FromResult(response);
        });
        return this;
    }

    /// <summary>Enqueues a response whose body blocks on the read until the token is cancelled.</summary>
    public FakeHttpMessageHandler EnqueueBlockingStream()
    {
        _responders.Enqueue((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new BlockingHttpContent(),
        }));
        return this;
    }

    /// <summary>Enqueues a transport-level failure (the send throws before producing a response).</summary>
    public FakeHttpMessageHandler EnqueueThrow(Exception exception)
    {
        _responders.Enqueue((_, _) => Task.FromException<HttpResponseMessage>(exception));
        return this;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        string? content = null;
        if (request.Content is not null)
        {
            content = await request.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        }
        Requests.Add(new RecordedRequest(request.Method, request.RequestUri, SnapshotHeaders(request), content));

        if (_responders.Count == 0)
        {
            throw new InvalidOperationException("FakeHttpMessageHandler received an unscripted request.");
        }

        var responder = _responders.Dequeue();
        return await responder(request, cancellationToken).ConfigureAwait(false);
    }

    private static Dictionary<string, string[]> SnapshotHeaders(HttpRequestMessage request)
    {
        var headers = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var header in request.Headers)
        {
            headers[header.Key] = header.Value.ToArray();
        }
        return headers;
    }

    private sealed class BlockingHttpContent : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => Task.CompletedTask;

        protected override bool TryComputeLength(out long length)
        {
            length = -1;
            return false;
        }

        protected override Task<Stream> CreateContentReadStreamAsync() => Task.FromResult<Stream>(new BlockingStream());
    }

    private sealed class BlockingStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => 0; set => throw new NotSupportedException(); }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken).ConfigureAwait(false);
            return 0;
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}

/// <summary>A snapshot of one outgoing request, captured before its content was disposed.</summary>
internal sealed record RecordedRequest(
    HttpMethod Method,
    Uri? Uri,
    IReadOnlyDictionary<string, string[]> Headers,
    string? Content)
{
    public string? Header(string name) => Headers.TryGetValue(name, out var values) ? values.FirstOrDefault() : null;
}
