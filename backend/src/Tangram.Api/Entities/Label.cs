namespace Tangram.Api.Entities;

/// <summary>
/// A named tag a board's cards can carry.
/// </summary>
/// <remarks>
/// Scoped to a board, not a workspace. Jira scopes labels to a project, which
/// would map to a workspace here, but the sync spine is board-scoped from end to
/// end: an operation carries a <c>BoardId</c>, and its broadcast goes to that
/// board's SignalR group. A workspace-level label created while looking at one
/// board could never reach anyone looking at another, so the vocabulary would
/// silently diverge per client until a refresh. Trello scopes labels per board,
/// and for a board-shaped sync model that is the honest choice.
/// </remarks>
public class Label
{
    public Guid Id { get; set; }
    public Guid BoardId { get; set; }
    public required string Name { get; set; }

    // A palette name -- "red", "blue" -- rather than a hex value. The colour has
    // to survive a theme change, and a stored #ff0000 would not: it is chosen
    // against one background and then rendered against another. The frontend
    // owns the mapping, which is also what keeps hex out of the database.
    public required string Color { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public Board Board { get; set; } = null!;
    public ICollection<CardLabel> CardLabels { get; set; } = new List<CardLabel>();
}

/// <summary>Join row putting one label on one card.</summary>
public class CardLabel
{
    public Guid CardId { get; set; }
    public Guid LabelId { get; set; }

    public Card Card { get; set; } = null!;
    public Label Label { get; set; } = null!;
}
