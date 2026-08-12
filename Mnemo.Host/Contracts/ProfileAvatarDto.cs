namespace Mnemo.Host.Contracts;

/// <summary>An uploaded avatar: the id the profile picture setting stores and the serve route reads back.</summary>
public sealed record ProfileAvatarDto(string AssetId);
