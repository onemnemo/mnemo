namespace Mnemo.Core.Models.Proofing;

/// <summary>
/// One replacement a client can apply over an issue's range.
/// </summary>
/// <param name="Replacement">
/// The text to put in place of the issue's span. An empty string means delete the span, which is how
/// a rule that flags a duplicated word offers its fix.
/// </param>
/// <param name="Label">
/// What to show on the chip when the replacement itself would not read as a label. Null means show
/// the replacement.
/// </param>
public sealed record ProofingFix(string Replacement, string? Label);
