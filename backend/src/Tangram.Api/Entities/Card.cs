namespace Tangram.Api.Entities;

public class Card
{
    public Guid Id { get; set; }
    public Guid ColumnId { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }

    public required string Rank { get; set; }

    // Date-only in meaning, stored as an instant at UTC midnight. A due date is
    // a day, not a moment, and storing it with a time invites two people in
    // different zones to disagree about whether something is overdue.
    public DateTimeOffset? DueAt { get; set; }

    // Null means nobody has said — see CardPriority for why that is a state
    // worth keeping rather than defaulting to Medium.
    public CardPriority? Priority { get; set; }

    // No FK constraint on purpose: memberships change, and a removed member
    // must not either block their removal or cascade-delete the cards they were
    // assigned. An assignee who is no longer a member simply stops resolving,
    // and the UI treats that as unassigned.
    public Guid? AssigneeId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Column Column { get; set; } = null!;
    public ICollection<CardLabel> CardLabels { get; set; } = new List<CardLabel>();
    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
}
