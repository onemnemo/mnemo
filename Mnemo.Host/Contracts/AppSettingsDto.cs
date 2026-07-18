namespace Mnemo.Host.Contracts;

/// <summary>
/// The app-level preferences the SPA hydrates at startup. <see cref="Theme"/> is
/// the lowercase theme id the SPA renders with (the DB keeps the canonical
/// capitalized name); <see cref="Language"/> is the culture code.
/// </summary>
public sealed record AppSettingsDto(string Theme, string Language);

/// <summary>
/// Build identity for the surfaces that display it (the Updates settings row, the
/// onboarding footer). Checking for and applying updates is a separate concern that
/// stays with the update orchestration phase.
/// </summary>
public sealed record AppInfoDto(string Version);
