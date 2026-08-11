namespace Tangram.Api.Services;

/// <summary>
/// The palette a label's colour must come from.
/// </summary>
/// <remarks>
/// Names rather than hex, validated server-side so a client cannot store a
/// colour the UI has no rendering for. Keeping the set closed is what lets the
/// frontend map each name to theme tokens and restyle the whole palette in one
/// place — an arbitrary hex would be chosen against one background and then
/// rendered against another when the theme flips.
/// </remarks>
public static class LabelColors
{
    public static readonly string[] All =
        ["grey", "red", "orange", "yellow", "green", "blue", "purple"];

    public const string Default = "grey";

    public static bool IsValid(string? color) =>
        color is not null && All.Contains(color, StringComparer.OrdinalIgnoreCase);

    public static string Normalize(string color) => color.ToLowerInvariant();

    public static string AllowedValues => string.Join(", ", All);
}
