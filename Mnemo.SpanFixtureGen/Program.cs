using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json.Nodes;

namespace Mnemo.SpanFixtureGen;

/// <summary>
/// Regenerates the differential fixture consumed by mnemo-web's
/// src/notes/model/spanDiff.test.ts.
///
/// Run (from the repo root, PowerShell -- the /p:OutDir switch dodges a
/// debugger lock on Mnemo.UI/bin that affects dotnet build/run/test in this
/// repo):
///
///   dotnet run --project Mnemo.SpanFixtureGen -p:OutDir=&lt;scratch&gt;\
///
/// Same seed + case count always produce byte-identical output (the gzip
/// stream is written at a fixed compression level with no name/timestamp in
/// its header, so re-running against an unchanged Mnemo.Core reproduces the
/// exact same .gz bytes -- a real regeneration diff only ever means the
/// underlying behavior actually changed). Regenerate only when
/// InlineSpanFormatApplier/InlineSpanText/InlineAutoLink or the TS port's
/// equivalent (spans.ts/format.ts/autolink.ts) changes behavior -- never to
/// make a failing differential case pass.
/// </summary>
public static class Program
{
    private const ulong DefaultSeed = 20260719UL;
    private const int DefaultCasesPerOp = 500;

    public static void Main(string[] args)
    {
        ulong seed = args.Length > 0 && ulong.TryParse(args[0], out var s) ? s : DefaultSeed;
        int casesPerOp = args.Length > 1 && int.TryParse(args[1], out var c) ? c : DefaultCasesPerOp;
        string outputPath = args.Length > 2 ? Path.GetFullPath(args[2]) : DefaultOutputPath();

        var rng = new SplitMix64(seed);
        var cases = CaseBuilder.BuildAll(ref rng, casesPerOp);

        var root = new JsonObject
        {
            ["seed"] = seed,
            ["casesPerOp"] = casesPerOp,
            ["operations"] = new JsonArray(CaseBuilder.Operations.Select(op => (JsonNode)op).ToArray()),
            ["caseCount"] = cases.Count,
            // Deliberately omitted: a "generatedAt" timestamp would make every
            // regeneration of an unchanged fixture produce a different file,
            // defeating the byte-for-byte reproducibility this fixture relies on.
            ["cases"] = cases,
        };

        string json = FixtureJsonWriter.Serialize(root);

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        using (var fileStream = new FileStream(outputPath, FileMode.Create, FileAccess.Write))
        // GZipStream never writes a filename/mtime into the gzip header (that's
        // GZipStream's own contract, not something we configure here), and a
        // fixed CompressionLevel keeps the deflate output itself stable, so
        // compressing identical JSON bytes twice yields byte-identical .gz files.
        using (var gzip = new GZipStream(fileStream, CompressionLevel.SmallestSize))
        {
            var jsonBytes = Encoding.UTF8.GetBytes(json);
            gzip.Write(jsonBytes, 0, jsonBytes.Length);
        }

        Console.WriteLine($"Wrote {cases.Count} cases ({casesPerOp}/op x {CaseBuilder.Operations.Length} ops, seed={seed}) to {outputPath}");
    }

    // CallerFilePath is a compile-time constant baked from this file's actual
    // location, so the default output path is correct even when OutDir
    // redirects the build's bin/obj somewhere else entirely (e.g. a scratch
    // temp dir) -- AppContext.BaseDirectory would not be.
    private static string DefaultOutputPath([CallerFilePath] string sourceFile = "")
    {
        var repoRoot = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(sourceFile)!, ".."));
        return Path.Combine(repoRoot, "mnemo-web", "src", "notes", "model", "fixtures", "span-diff.json.gz");
    }
}
