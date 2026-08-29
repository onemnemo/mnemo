namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Skips tests when the vendored Typst binary is absent. The skip reason is set during discovery
/// because availability is not a compile-time constant.
/// </summary>
public sealed class TypstFactAttribute : FactAttribute
{
    public TypstFactAttribute()
    {
        if (!NoteTypstToolchain.Available)
            Skip = "The vendored Typst binary is not present. Run scripts/restore-typst to compile against it.";
    }
}
