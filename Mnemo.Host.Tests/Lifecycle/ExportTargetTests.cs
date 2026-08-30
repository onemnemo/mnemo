using System;
using System.IO;
using Mnemo.Host.Lifecycle;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// The destination every save route runs through. It takes a path the client supplies, which is the
/// point of the feature, so what it refuses is the whole of the protection, and what it appends is
/// what stops a chooser's bare name from producing a file nothing can open.
/// </summary>
public sealed class ExportTargetTests : IDisposable
{
    private readonly string _folder = Directory.CreateTempSubdirectory("mnemo-export-target").FullName;

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    [Fact]
    public void SplitsAChosenPathIntoAFolderAndAName()
    {
        var chosen = Path.Combine(_folder, "deck.mnemo");

        Assert.True(ExportTarget.TryResolvePath(chosen, ".mnemo", out var target, out var error));

        Assert.Equal(string.Empty, error);
        Assert.Equal(_folder, target!.Directory);
        Assert.Equal(chosen, target.FullPath);
    }

    [Fact]
    public void AppendsTheRequiredExtensionWhenTheNameArrivesWithoutIt()
    {
        Assert.True(ExportTarget.TryResolvePath(Path.Combine(_folder, "deck"), ".mnemo", out var target, out _));

        Assert.Equal(Path.Combine(_folder, "deck.mnemo"), target!.FullPath);
    }

    [Fact]
    public void LeavesTheExtensionAloneWhateverCaseItArrivesIn()
    {
        Assert.True(ExportTarget.TryResolvePath(Path.Combine(_folder, "Deck.MNEMO"), ".mnemo", out var target, out _));

        Assert.Equal(Path.Combine(_folder, "Deck.MNEMO"), target!.FullPath);
    }

    [Fact]
    public void KeepsANameThatMerelyContainsTheExtensionEarlyOn()
    {
        Assert.True(ExportTarget.TryResolvePath(Path.Combine(_folder, "notes.mnemo.backup"), ".mnemo", out var target, out _));

        Assert.Equal(Path.Combine(_folder, "notes.mnemo.backup.mnemo"), target!.FullPath);
    }

    [Fact]
    public void AcceptsAnyNameWhenNoExtensionIsRequired()
    {
        Assert.True(ExportTarget.TryResolvePath(Path.Combine(_folder, "whatever"), requiredExtension: null, out var target, out _));

        Assert.Equal(Path.Combine(_folder, "whatever"), target!.FullPath);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void RefusesAPathThatNamesNothing(string path)
    {
        Assert.False(ExportTarget.TryResolvePath(path, ".mnemo", out var target, out var error));

        Assert.Null(target);
        Assert.Equal("invalid_directory", error);
    }

    [Fact]
    public void RefusesAPathThatIsNotAbsolute()
    {
        Assert.False(ExportTarget.TryResolvePath("exports/deck.mnemo", ".mnemo", out var target, out var error));

        Assert.Null(target);
        Assert.Equal("invalid_directory", error);
    }

    [Fact]
    public void RefusesAPathThatEndsAtAFolder()
    {
        Assert.False(ExportTarget.TryResolvePath(_folder + Path.DirectorySeparatorChar, ".mnemo", out var target, out var error));

        Assert.Null(target);
        Assert.Equal("invalid_file_name", error);
    }

    [Fact]
    public void RefusesAFolderWhoseParentDoesNotExistEither()
    {
        var nowhere = Path.Combine(_folder, "missing", "deeper", "deck.mnemo");

        Assert.False(ExportTarget.TryResolvePath(nowhere, ".mnemo", out _, out var error));

        Assert.Equal("missing_directory", error);
    }

    [Fact]
    public void AcceptsAFolderThatDoesNotExistYetWhenItsParentDoes()
    {
        // The write route creates it. One level is a folder the user named in a chooser; a whole
        // tree is a typo nobody meant to conjure.
        var fresh = Path.Combine(_folder, "Exports");

        Assert.True(ExportTarget.TryResolvePath(Path.Combine(fresh, "deck.mnemo"), ".mnemo", out var target, out _));

        Assert.Equal(fresh, target!.Directory);
    }

    [Fact]
    public void NormalizesTraversalOutOfTheFolderItLandsIn()
    {
        // The traversal resolves rather than escaping a check: what matters is that the answer is
        // one normalized path, so the folder that gets remembered is the folder written to.
        var winding = Path.Combine(_folder, "sub", "..", "deck.mnemo");

        Assert.True(ExportTarget.TryResolvePath(winding, ".mnemo", out var target, out _));

        Assert.Equal(_folder, target!.Directory);
        Assert.Equal(Path.Combine(_folder, "deck.mnemo"), target.FullPath);
    }
}
