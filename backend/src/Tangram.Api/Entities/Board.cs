namespace Tangram.Api.Entities;

public class Board
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public required string Name { get; set; }

    // Current high-water mark for this board's operation sequence.
    // Incremented transactionally each time a mutating op is assigned a seq.
    public long Seq { get; set; }

    // Archiving hides a board from the workspace's default listing without
    // destroying it. Deliberately not a delete: a board holds every card anyone
    // has written on it, and "put it away" is what people almost always mean.
    // Its rows, operations and undo history stay intact and reversible.
    public DateTimeOffset? ArchivedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Workspace Workspace { get; set; } = null!;
    public ICollection<Column> Columns { get; set; } = new List<Column>();
    public ICollection<Operation> Operations { get; set; } = new List<Operation>();
}
