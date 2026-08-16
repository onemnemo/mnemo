namespace Mnemo.Host.Contracts;

/// <summary>Body of a single-setting update: <c>{ "value": "..." }</c>.</summary>
public sealed record UpdateSettingDto(string Value);
