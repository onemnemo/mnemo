namespace Mnemo.Core.Enums;

/// <summary>
/// How an import treats an incoming item that already exists in the library.
/// </summary>
public enum ImportConflictPolicy
{
    /// <summary>Import the incoming item alongside the existing one; the copy gets a numbered suffix.</summary>
    KeepBoth,

    /// <summary>Leave the existing item untouched and drop the incoming one.</summary>
    Skip,

    /// <summary>Overwrite the existing item with the incoming one.</summary>
    Replace
}
