using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Transfer;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Transfer;

/// <summary>Logs the full warning list as one entry per import.</summary>
public sealed class TransferWarningLogTests
{
    [Fact]
    public void AllWarnings_WriteAsOneLogEntry()
    {
        var logger = new RecordingLogger();
        var warnings = new List<TransferWarningDto>
        {
            new("AnkiMediaImportFailed", new Dictionary<string, string> { ["mediaName"] = "a.svg", ["error"] = "unsupported type" }),
            new("AnkiMediaImportFailed", new Dictionary<string, string> { ["mediaName"] = "b.svg", ["error"] = "unsupported type" }),
            new("SettingsKeyNotAllowed", new Dictionary<string, string> { ["settingKey"] = "ai.remoteKey" }),
        };

        TransferWarningLog.Log(logger, "Flashcards.Transfer", warnings);

        var entry = Assert.Single(logger.Entries);
        Assert.Equal("Flashcards.Transfer", entry.Category);
        Assert.Contains("a.svg", entry.Message);
        Assert.Contains("b.svg", entry.Message);
        Assert.Contains("ai.remoteKey", entry.Message);
    }

    [Fact]
    public void SameKeyAndReason_GroupsIntoOneLineWithACountAndAllNames()
    {
        var logger = new RecordingLogger();
        var warnings = Enumerable.Range(0, 200)
            .Select(i => new TransferWarningDto(
                "AnkiMediaImportFailed",
                new Dictionary<string, string> { ["mediaName"] = $"file-{i}.svg", ["error"] = "unsupported type" }))
            .ToList();

        TransferWarningLog.Log(logger, "Flashcards.Transfer", warnings);

        var entry = Assert.Single(logger.Entries);
        Assert.Contains("x200", entry.Message);
        Assert.Contains("unsupported type", entry.Message);
        Assert.Contains("file-0.svg", entry.Message);
        Assert.Contains("file-199.svg", entry.Message);
    }

    [Fact]
    public void DifferentReasonsUnderTheSameKey_StayOnSeparateLines()
    {
        var logger = new RecordingLogger();
        var warnings = new List<TransferWarningDto>
        {
            new("AnkiMediaImportFailed", new Dictionary<string, string> { ["mediaName"] = "a.svg", ["error"] = "unsupported type" }),
            new("AnkiMediaImportFailed", new Dictionary<string, string> { ["mediaName"] = "b.svg", ["error"] = "file too large" }),
        };

        TransferWarningLog.Log(logger, "Flashcards.Transfer", warnings);

        var entry = Assert.Single(logger.Entries);
        var lines = entry.Message.Split(Environment.NewLine);
        Assert.Equal(2, lines.Length);
        Assert.Contains(lines, line => line.Contains("unsupported type") && line.Contains("a.svg"));
        Assert.Contains(lines, line => line.Contains("file too large") && line.Contains("b.svg"));
    }

    [Fact]
    public void NoWarnings_WritesNothing()
    {
        var logger = new RecordingLogger();

        TransferWarningLog.Log(logger, "Flashcards.Transfer", []);

        Assert.Empty(logger.Entries);
    }

    [Fact]
    public void APathInAReason_IsReducedToItsFileName()
    {
        var logger = new RecordingLogger();
        var warnings = new List<TransferWarningDto>
        {
            new("AnkiMediaImportFailed", new Dictionary<string, string>
            {
                ["mediaName"] = "a.svg",
                ["error"] = @"Source file not found: C:\Users\shado\AppData\Local\Temp\a.svg",
            }),
        };

        TransferWarningLog.Log(logger, "Flashcards.Transfer", warnings);

        var entry = Assert.Single(logger.Entries);
        Assert.Contains("Source file not found: a.svg", entry.Message);
        Assert.DoesNotContain("shado", entry.Message);
        Assert.DoesNotContain(@"C:\Users", entry.Message);
    }

    [Theory]
    // Still redacted: a real, rooted filesystem path.
    [InlineData(@"C:\Users\shado\AppData\Local\Temp\a.svg", "a.svg")]
    [InlineData(@"Failed reading \\server\share\deck.apkg", @"Failed reading deck.apkg")]
    [InlineData("/home/shado/notes/note.md", "note.md")]
    [InlineData(@"C:\Users\shado\a.svg.", "a.svg.")]
    [InlineData("a.svg", "a.svg")]
    [InlineData("File is not a supported image (PNG, JPEG, GIF, WebP or BMP).", "File is not a supported image (PNG, JPEG, GIF, WebP or BMP).")]
    // Left alone: a slash that is not a rooted path.
    [InlineData("supported formats are PNG/JPEG only", "supported formats are PNG/JPEG only")]
    [InlineData("keep and/or discard the file", "keep and/or discard the file")]
    [InlineData("scored 1/2 on the check", "scored 1/2 on the check")]
    [InlineData("see https://example.com/docs/import for details", "see https://example.com/docs/import for details")]
    public void RedactPaths_ReducesOnlyARootedPathToItsFileName(string input, string expected)
    {
        Assert.Equal(expected, TransferWarningLog.RedactPaths(input));
    }

    [Fact]
    public void ASlashInAnItemName_IsNeverRedacted()
    {
        // Names are never redacted; a slash in a name is not a path.
        var logger = new RecordingLogger();
        var warnings = new List<TransferWarningDto>
        {
            new("AnkiDeckImportFailed", new Dictionary<string, string> { ["deckName"] = "Spanish/Verbs", ["error"] = "boom" }),
            new("NoteImportFailed", new Dictionary<string, string> { ["noteTitle"] = "Q1/Q2 review", ["error"] = "boom" }),
        };

        TransferWarningLog.Log(logger, "Flashcards.Transfer", warnings);

        var entry = Assert.Single(logger.Entries);
        Assert.Contains("Spanish/Verbs", entry.Message);
        Assert.Contains("Q1/Q2 review", entry.Message);
    }

    [Fact]
    public void ABlankReason_LeavesNoEmptyColonInTheLine()
    {
        var logger = new RecordingLogger();
        var warnings = new List<TransferWarningDto>
        {
            new("NoteImportFailed", new Dictionary<string, string> { ["noteTitle"] = "a", ["error"] = "" }),
        };

        TransferWarningLog.Log(logger, "Notes.Transfer", warnings);

        var entry = Assert.Single(logger.Entries);
        Assert.Equal("NoteImportFailed x1 [noteTitle=a]", entry.Message);
    }

    private sealed class RecordingLogger : ILoggerService
    {
        public List<(string Category, string Message)> Entries { get; } = [];

        public void Log(LogLevel level, string category, string message, Exception? exception = null) =>
            Entries.Add((category, message));
    }
}
