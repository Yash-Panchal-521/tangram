namespace Tangram.Api.Entities;

public class Card
{
    public Guid Id { get; set; }
    public Guid ColumnId { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }

    public required string Rank { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Column Column { get; set; } = null!;
}
