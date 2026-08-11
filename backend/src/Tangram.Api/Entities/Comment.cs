namespace Tangram.Api.Entities;

/// <summary>
/// Something a person wrote on a card.
/// </summary>
/// <remarks>
/// The distinction from the activity feed that was removed matters, and is the
/// reason this exists so soon after that was deleted: that feed was *derived
/// history*, written by the machine from the operations log. A comment is
/// authored — somebody chose the words and chose to say them. If this ever
/// grows a "History" tab beside it, that is the old feature returning through a
/// side door.
///
/// No FK on AuthorId, matching Card.AssigneeId: removing someone from a
/// workspace must not cascade-delete what they wrote, or block their removal.
/// An author who no longer resolves is shown as a former member.
/// </remarks>
public class Comment
{
    public Guid Id { get; set; }
    public Guid CardId { get; set; }
    public Guid AuthorId { get; set; }
    public required string Body { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    // Null until edited. Kept rather than silently rewriting CreatedAt, because
    // "edited" is information the reader needs: a comment someone replied to
    // may not say what it said when they replied.
    public DateTimeOffset? EditedAt { get; set; }

    public Card Card { get; set; } = null!;
}
