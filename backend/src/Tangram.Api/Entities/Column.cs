namespace Tangram.Api.Entities;

public class Column
{
    public Guid Id { get; set; }
    public Guid BoardId { get; set; }
    public required string Name { get; set; }

    // Fractional/lexicographic rank string. A move updates only this column's
    // row — never a renumber of siblings.
    public required string Rank { get; set; }

    // Work-in-progress limits, both optional and independent.
    //
    // Nullable rather than 0/int.MaxValue sentinels: "no limit" and "a limit
    // of zero" are different statements, and a column limited to zero is a
    // meaningful thing to say about a stage nobody should be starting work in.
    //
    // Advisory, never enforced. A limit is a signal to a team, not a rule the
    // server applies -- rejecting a move because a column is full would strand
    // work in the previous stage, which is the opposite of what a WIP limit is
    // for. Jira signals a breach and lets the drop happen; so does this.
    public int? MinCards { get; set; }
    public int? MaxCards { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Board Board { get; set; } = null!;
    public ICollection<Card> Cards { get; set; } = new List<Card>();
}
