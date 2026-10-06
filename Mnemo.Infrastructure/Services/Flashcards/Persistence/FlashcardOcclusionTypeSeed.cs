using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Adds the image occlusion card type to a collection that predates it. An existing row is never overwritten.
/// </summary>
internal static class FlashcardOcclusionTypeSeed
{
    public static Task ApplyAsync(FlashcardMigrationContext context) =>
        FlashcardFactBackfill.SeedCardTypesAsync(
            context,
            FlashcardCardType.CreateBuiltIns(context.Time.GetUtcNow())
                .Where(type => type.Id == FlashcardCardType.OcclusionId));
}
