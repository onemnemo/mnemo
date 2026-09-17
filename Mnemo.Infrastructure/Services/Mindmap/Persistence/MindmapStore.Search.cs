using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace Mnemo.Infrastructure.Services.Mindmap.Persistence;

/// <summary>
/// The FTS half of the mindmap store: the in-map query the find bar and the assistant's find tool
/// share, and the cross-map query behind the global search. Both read the same mirror; neither
/// deserializes a document.
/// </summary>
public sealed partial class MindmapStore
{
    public Task<IReadOnlyList<MindmapSearchHit>> SearchAsync(string mapId, string query, int limit, CancellationToken cancellationToken = default)
    {
        var match = BuildMatchQuery(query);
        if (match is null)
            return Task.FromResult<IReadOnlyList<MindmapSearchHit>>(Array.Empty<MindmapSearchHit>());

        return ReadAsync<IReadOnlyList<MindmapSearchHit>>(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            // The FTS mirror keeps a held map's rows so that restoring one does not have to rebuild the
            // index, so search joins the document row to answer only for a map the library still shows.
            cmd.CommandText = """
                SELECT s.ElementId, s.Text FROM MindmapSearch s
                JOIN Mindmaps m ON m.Id = s.MapId
                WHERE s.MapId = $map AND s.Text MATCH $q AND m.TrashId IS NULL
                LIMIT $limit;
                """;
            cmd.Parameters.AddWithValue("$map", mapId);
            cmd.Parameters.AddWithValue("$q", match);
            cmd.Parameters.AddWithValue("$limit", limit <= 0 ? 50 : limit);

            var hits = new List<MindmapSearchHit>();
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                hits.Add(new MindmapSearchHit(reader.GetString(0), reader.GetString(1)));

            return hits;
        }, cancellationToken);
    }

    public Task<IReadOnlyList<MindmapSearchMatch>> SearchAllAsync(string query, int limit, CancellationToken cancellationToken = default)
    {
        var match = BuildMatchQuery(query, anyToken: true);
        if (match is null)
            return Task.FromResult<IReadOnlyList<MindmapSearchMatch>>(Array.Empty<MindmapSearchMatch>());

        return ReadAsync<IReadOnlyList<MindmapSearchMatch>>(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            // One row per map, so the limit bounds maps rather than nodes and a map that says the
            // word on hundreds of nodes cannot crowd every other map out of the answer. The bare
            // columns ride with MIN(rank), which SQLite defines as the row that holds the minimum;
            // rank is the FTS5 bm25 score, lower is better, so the row is the node that says the
            // most of the query rather than the first one the mirror stored.
            cmd.CommandText = """
                SELECT s.MapId, s.ElementId, s.Text, MIN(s.rank) FROM MindmapSearch s
                JOIN Mindmaps m ON m.Id = s.MapId
                WHERE s.Text MATCH $q AND m.TrashId IS NULL
                GROUP BY s.MapId
                LIMIT $limit;
                """;
            cmd.Parameters.AddWithValue("$q", match);
            cmd.Parameters.AddWithValue("$limit", limit <= 0 ? 200 : limit);

            var matches = new List<MindmapSearchMatch>();
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                matches.Add(new MindmapSearchMatch(reader.GetString(0), reader.GetString(1), reader.GetString(2)));

            return matches;
        }, cancellationToken);
    }

    /// <summary>
    /// Turns a user query into a safe FTS5 MATCH expression: each whitespace token becomes a quoted
    /// prefix phrase (embedded quotes doubled), so punctuation can never break FTS5 syntax. The
    /// phrases are joined by implicit AND for the in-map find, which looks for a node that says all
    /// of them, and by OR when <paramref name="anyToken"/> is set, which is how the other search
    /// providers read a query and lets a map match on words spread over several nodes. Returns null
    /// when the query has no searchable tokens.
    /// <para>
    /// Prefix rather than whole-word, because the find bar runs this on every keystroke and a query
    /// that only answers once the whole word is typed reads as broken until then. The other search
    /// providers match inside words, so this is also the closer of the two to how the rest of the
    /// app searches.
    /// </para>
    /// </summary>
    private static string? BuildMatchQuery(string query, bool anyToken = false)
    {
        if (string.IsNullOrWhiteSpace(query))
            return null;

        var tokens = query.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);

        var builder = new StringBuilder();
        foreach (var token in tokens)
        {
            // Skip pure-punctuation tokens: the FTS5 tokenizer would reduce them to an empty phrase.
            if (!ContainsLetterOrDigit(token))
                continue;

            if (builder.Length > 0)
                builder.Append(anyToken ? " OR " : " ");
            builder.Append('"').Append(token.Replace("\"", "\"\"")).Append("\"*");
        }

        return builder.Length == 0 ? null : builder.ToString();
    }

    private static bool ContainsLetterOrDigit(string token)
    {
        foreach (var c in token)
        {
            if (char.IsLetterOrDigit(c))
                return true;
        }

        return false;
    }
}
