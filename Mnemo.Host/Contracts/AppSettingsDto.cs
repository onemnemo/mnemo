namespace Mnemo.Host.Contracts;

/// <summary>
/// The app-level preferences the SPA hydrates at startup. <see cref="Theme"/> is
/// the lowercase theme id the SPA renders with (the DB keeps the canonical
/// capitalized name); <see cref="Language"/> is the culture code.
/// </summary>
public sealed record AppSettingsDto(string Theme, string Language);
