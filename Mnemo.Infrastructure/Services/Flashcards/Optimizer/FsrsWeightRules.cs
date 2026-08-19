using System;
using System.Collections.Generic;
using System.Globalization;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Optimizer;

/// <summary>
/// The box the FSRS-6 parameters are allowed to live in, and the gate every weight vector passes
/// before it is stored.
/// </summary>
/// <remarks>
/// The scheduler checks only the vector's length and the decay slot, and its clamp helper passes a
/// NaN straight through. A NaN stability cannot be written to SQLite, so the column lands NULL and
/// the card's memory state silently resets to a fresh card's on the next answer. Every write path
/// therefore runs a vector past <see cref="TryValidate"/> first, and the fitter projects its
/// candidates onto the same box with <see cref="Clip"/>, so nothing outside it can ever be offered.
///
/// The bounds are the ranges the reference FSRS-6 trainer holds its own parameters to.
/// </remarks>
public static class FsrsWeightRules
{
    /// <summary>Slot count of an FSRS-6 vector.</summary>
    public const int Fsrs6Count = 21;

    /// <summary>Slot count of the vector the FSRS-5 optimizer emits, which the scheduler pads.</summary>
    public const int Fsrs5Count = 19;

    // FSRS-5 pinned the forgetting curve's decay at -0.5 and had no short-term damping term, so
    // these two are what padding a 19-slot vector to 21 means. Mirrors the scheduler's own padding.
    private const double Fsrs5ShortTermDamping = 0.0d;
    private const double Fsrs5Decay = 0.5d;

    private static readonly double[] LowerBounds =
    {
        0.001d, 0.001d, 0.001d, 0.001d, 1.0d, 0.001d, 0.001d,
        0.001d, 0.0d, 0.0d, 0.001d, 0.001d, 0.001d, 0.001d,
        0.0d, 0.0d, 1.0d, 0.0d, 0.0d, 0.0d, 0.1d
    };

    private static readonly double[] UpperBounds =
    {
        100.0d, 100.0d, 100.0d, 100.0d, 10.0d, 4.0d, 4.0d,
        0.75d, 4.5d, 0.8d, 3.5d, 5.0d, 0.25d, 0.9d,
        4.0d, 1.0d, 6.0d, 2.0d, 2.0d, 0.8d, 0.8d
    };

    /// <summary>Smallest value slot <paramref name="index"/> may hold.</summary>
    public static double LowerBound(int index) => LowerBounds[index];

    /// <summary>Largest value slot <paramref name="index"/> may hold.</summary>
    public static double UpperBound(int index) => UpperBounds[index];

    /// <summary>
    /// Checks a vector the way it will be read: a 19-slot vector is padded to 21 first, because
    /// that is what the scheduler schedules on. Null is valid and means the published defaults.
    /// </summary>
    /// <param name="weights">The vector to check, or null for the defaults.</param>
    /// <param name="error">Set to a reason when the vector is refused, null otherwise.</param>
    /// <returns>True when the vector is safe to store.</returns>
    public static bool TryValidate(IReadOnlyList<double>? weights, out string? error)
    {
        if (weights is null)
        {
            error = null;
            return true;
        }

        if (weights.Count is not (Fsrs5Count or Fsrs6Count))
        {
            error = string.Create(CultureInfo.InvariantCulture,
                $"FSRS weights must hold {Fsrs5Count} or {Fsrs6Count} values, but this vector has {weights.Count}.");
            return false;
        }

        var expanded = Expand(weights);
        for (var i = 0; i < Fsrs6Count; i++)
        {
            var value = expanded[i];
            if (!double.IsFinite(value))
            {
                error = string.Create(CultureInfo.InvariantCulture, $"FSRS weight w{i} is not a finite number.");
                return false;
            }

            if (value < LowerBounds[i] || value > UpperBounds[i])
            {
                error = string.Create(CultureInfo.InvariantCulture,
                    $"FSRS weight w{i} must be between {LowerBounds[i]} and {UpperBounds[i]}, but it is {value}.");
                return false;
            }
        }

        error = null;
        return true;
    }

    /// <summary>Pads a 19-slot vector to 21, or copies a 21-slot one. Throws on any other length.</summary>
    public static double[] Expand(IReadOnlyList<double> weights)
    {
        ArgumentNullException.ThrowIfNull(weights);

        if (weights.Count == Fsrs6Count)
        {
            var copy = new double[Fsrs6Count];
            for (var i = 0; i < Fsrs6Count; i++)
                copy[i] = weights[i];
            return copy;
        }

        if (weights.Count != Fsrs5Count)
        {
            throw new ArgumentException(
                $"FSRS weights must hold {Fsrs5Count} or {Fsrs6Count} values, but this vector has {weights.Count}.",
                nameof(weights));
        }

        var padded = new double[Fsrs6Count];
        for (var i = 0; i < Fsrs5Count; i++)
            padded[i] = weights[i];
        padded[19] = Fsrs5ShortTermDamping;
        padded[20] = Fsrs5Decay;
        return padded;
    }

    /// <summary>
    /// Projects a vector onto the box, slot by slot. A non-finite slot takes the published default
    /// rather than a bound, because there is no direction to pull it in.
    /// </summary>
    public static double[] Clip(IReadOnlyList<double> weights)
    {
        var expanded = Expand(weights);
        var defaults = FlashcardFsrsParameters.Default.Weights;
        for (var i = 0; i < Fsrs6Count; i++)
        {
            var value = double.IsFinite(expanded[i]) ? expanded[i] : defaults[i];
            expanded[i] = Math.Min(UpperBounds[i], Math.Max(LowerBounds[i], value));
        }
        return expanded;
    }

    /// <summary>The published defaults, as a fresh 21-slot array the caller may keep.</summary>
    public static double[] Defaults() => Expand(FlashcardFsrsParameters.Default.Weights);
}
