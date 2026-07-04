namespace Tangram.Api.Entities;

// Append-only log of every mutating action on a board. The (BoardId, Seq) pair
// is the authoritative order clients reconcile against — last-write-wins by
// this order, never by wall-clock time.
public class Operation
{
    public Guid Id { get; set; }
    public Guid BoardId { get; set; }
    public long Seq { get; set; }
    public required string OpType { get; set; }
    public required string Payload { get; set; } // jsonb
    public Guid ActorId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Board Board { get; set; } = null!;
}
