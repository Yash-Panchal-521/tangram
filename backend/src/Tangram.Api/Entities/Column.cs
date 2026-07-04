namespace Tangram.Api.Entities;

public class Column
{
    public Guid Id { get; set; }
    public Guid BoardId { get; set; }
    public required string Name { get; set; }

    // Fractional/lexicographic rank string. A move updates only this column's
    // row — never a renumber of siblings.
    public required string Rank { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Board Board { get; set; } = null!;
    public ICollection<Card> Cards { get; set; } = new List<Card>();
}
