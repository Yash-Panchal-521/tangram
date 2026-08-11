namespace Tangram.Api.Entities;

/// <summary>
/// How urgent a card is, in Jira's five levels.
/// </summary>
/// <remarks>
/// Nullable on <see cref="Card"/> rather than defaulting to Medium, which is
/// what Jira does. Two reasons: every card that already exists would otherwise
/// be given a priority nobody chose, and on a board where most work is simply
/// "the next thing", a priority on everything means a priority on nothing —
/// the field only carries information when some cards go without.
///
/// The explicit values order the levels for sorting later. Stored as a string
/// so the column stays readable in the database, matching
/// <see cref="MembershipRole"/>; the numbers never reach it.
/// </remarks>
public enum CardPriority
{
    Highest = 1,
    High = 2,
    Medium = 3,
    Low = 4,
    Lowest = 5
}
