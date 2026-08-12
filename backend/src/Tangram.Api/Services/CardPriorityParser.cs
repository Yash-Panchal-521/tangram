using Tangram.Api.Entities;

namespace Tangram.Api.Services;

/// <summary>
/// Turns the wire's priority string into the enum, or refuses.
/// </summary>
/// <remarks>
/// Shared by the controller (which turns a refusal into a 400) and the service
/// (which is the shared spine and should not depend on having been called
/// through that controller).
///
/// The check that matters is <c>Enum.IsDefined</c>. <c>Enum.TryParse</c> happily
/// accepts any number — <c>"7"</c> parses as a <see cref="CardPriority"/> of 7 —
/// so without it a typo becomes a value no UI can render and no filter matches.
/// </remarks>
public static class CardPriorityParser
{
    public const string AllowedValues = "Highest, High, Medium, Low, or Lowest";

    public static bool TryParse(string? value, out CardPriority priority) =>
        Enum.TryParse(value, ignoreCase: true, out priority) && Enum.IsDefined(priority);

    public static CardPriority Parse(string value) =>
        TryParse(value, out var priority)
            ? priority
            : throw new BoardOperationConflictException($"Priority must be one of {AllowedValues}.");

    /// <summary>Absent is fine — a card without a priority is the normal case.</summary>
    public static bool IsValid(string? value) =>
        string.IsNullOrWhiteSpace(value) || TryParse(value, out _);

    /// <summary>Absent stays absent; anything present must be a real level.</summary>
    public static CardPriority? ParseOrNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : Parse(value);
}
