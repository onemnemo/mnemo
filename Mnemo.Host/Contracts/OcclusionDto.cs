using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>One mask as review draws it. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>.</summary>
public sealed record OcclusionMaskDto(
    string Id,
    string Shape,
    double X,
    double Y,
    double W,
    double H,
    IReadOnlyList<IReadOnlyList<double>>? Points,
    string? Label,
    string? Group,
    int Order)
{
    public static OcclusionMaskDto FromModel(OcclusionMask mask) => new(
        mask.Id,
        mask.Shape,
        mask.X,
        mask.Y,
        mask.W,
        mask.H,
        mask.Points?.Select(p => (IReadOnlyList<double>)[p[0], p[1]]).ToList(),
        mask.Label,
        mask.Group,
        mask.Order);
}

/// <summary>What review draws an occlusion card from. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>.</summary>
/// <param name="ImageAssetId">Null when the image file is not served.</param>
public sealed record OcclusionDto(
    string Mode,
    IReadOnlyList<OcclusionMaskDto> Masks,
    IReadOnlyList<string> AskedIds,
    string Back,
    string? ImageAssetId);
