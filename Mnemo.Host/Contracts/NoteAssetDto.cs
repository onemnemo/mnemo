namespace Mnemo.Host.Contracts;

/// <summary>A stored note image upload: the id an image block stores in its <c>path</c>.</summary>
public sealed record NoteAssetDto(string AssetId, string DisplayName, long SizeBytes);

/// <summary>An open note editing session, as registered with the asset sweep.</summary>
public sealed record NoteAssetSessionDto(string SessionId);
