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

    // How to reverse this operation, captured at write time because the payload
    // alone cannot express it: it records the *new* state, and an undo needs the
    // old one. A rename stores the title it changed to, never the title it
    // changed from, so reconstructing the inverse afterwards is impossible.
    //
    // Null means the operation is not undoable — which currently only happens
    // for operations that are themselves undos. Not storing an inverse for those
    // is what stops undo from becoming a redo, and then a loop.
    public string? InverseOpType { get; set; }
    public string? InversePayload { get; set; } // jsonb

    // Set when this operation has been reversed, so the same action can't be
    // undone twice.
    public DateTimeOffset? UndoneAt { get; set; }

    public Board Board { get; set; } = null!;
}
