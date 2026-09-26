using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Packaging;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Packaging;

public sealed class PackageImportOrderTests
{
    [Fact]
    public void A_payload_comes_after_the_payloads_it_follows()
    {
        var order = Order(
            ["flashcards", "mindmaps", "notes"],
            Handler("flashcards"), Handler("mindmaps", "notes", "flashcards"), Handler("notes"));

        Assert.Equal(["flashcards", "notes", "mindmaps"], order);
    }

    [Fact]
    public void A_dependency_loop_neither_hangs_nor_drops_a_payload()
    {
        var order = Order(["a", "b"], Handler("a", "b"), Handler("b", "a"));

        Assert.Equal(["b", "a"], order);
    }

    [Fact]
    public void A_dependency_the_package_lacks_and_an_unknown_payload_keep_manifest_order()
    {
        var order = Order(
            ["unknown.payload", "mindmaps", "settings"],
            Handler("mindmaps", "notes", "flashcards"), Handler("settings"));

        Assert.Equal(["unknown.payload", "mindmaps", "settings"], order);
    }

    [Fact]
    public void Entries_of_one_type_keep_their_order()
    {
        var entries = new List<MnemoPackageEntry>
        {
            new() { PayloadType = "proofing", Path = "p" },
            new() { PayloadType = "notes", Path = "n1" },
            new() { PayloadType = "notes", Path = "n2" },
        };

        var order = MnemoPackageService.InImportOrder(entries, Handlers(Handler("proofing", "notes"), Handler("notes")));

        Assert.Equal(["n1", "n2", "p"], order.Select(e => e.Path));
    }

    private static string[] Order(string[] manifest, params StubHandler[] handlers) =>
        MnemoPackageService.InImportOrder(
                manifest.Select(t => new MnemoPackageEntry { PayloadType = t, Path = t }).ToList(),
                Handlers(handlers))
            .Select(e => e.PayloadType)
            .ToArray();

    private static Dictionary<string, IMnemoPayloadHandler> Handlers(params StubHandler[] handlers) =>
        handlers.ToDictionary(h => h.PayloadType, h => (IMnemoPayloadHandler)h, StringComparer.OrdinalIgnoreCase);

    private static StubHandler Handler(string type, params string[] after) => new(type, after);

    private sealed class StubHandler(string payloadType, IReadOnlyCollection<string> importsAfter) : IMnemoPayloadHandler
    {
        public string PayloadType => payloadType;

        public IReadOnlyCollection<string> ImportsAfter => importsAfter;

        public Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
