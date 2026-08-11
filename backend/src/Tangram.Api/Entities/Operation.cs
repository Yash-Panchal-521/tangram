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

    // Nothing reads this log except sync: a client that reconnects asks for
    // everything after the seq it last saw, and replays it. It carried inverse
    // payloads and undo markers while the board had an activity feed and an
    // undo; both were removed, and with them the only readers of that state.
    //
    // Worth knowing before adding either back: an inverse cannot be
    // reconstructed after the fact. The payload records the state an operation
    // *produced*, never the one it replaced, so a rename that did not capture
    // the old title before assigning the new one is permanently un-undoable.

    public Board Board { get; set; } = null!;
}
