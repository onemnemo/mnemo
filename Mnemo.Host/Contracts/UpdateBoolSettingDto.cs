namespace Mnemo.Host.Contracts;

/// <summary>Body of a single boolean-setting update: <c>{ "value": true }</c>.</summary>
public sealed record UpdateBoolSettingDto(bool Value);
