namespace Mnemo.SpanFixtureGen;

/// <summary>
/// Deterministic PRNG so the fixture is reproducible across machines and .NET
/// versions. System.Random's algorithm is not documented/stable across
/// runtimes, so it can't be used for a fixture that has to stay byte-identical
/// on regeneration; SplitMix64 is a fixed, well-known algorithm instead.
/// </summary>
public struct SplitMix64
{
    private ulong _state;

    public SplitMix64(ulong seed)
    {
        _state = seed;
    }

    public ulong NextUInt64()
    {
        _state += 0x9E3779B97F4A7C15UL;
        ulong z = _state;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }

    /// <summary>Uniform in [minInclusive, maxExclusive). Returns minInclusive if the range is empty.</summary>
    public int NextInt(int minInclusive, int maxExclusive)
    {
        if (maxExclusive <= minInclusive) return minInclusive;
        var range = (ulong)(maxExclusive - minInclusive);
        return minInclusive + (int)(NextUInt64() % range);
    }

    public double NextDouble() => (NextUInt64() >> 11) * (1.0 / (1UL << 53));

    public bool NextBool(double probabilityTrue = 0.5) => NextDouble() < probabilityTrue;

    public T Pick<T>(IReadOnlyList<T> items) => items[NextInt(0, items.Count)];
}
