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

    // The seq this operation reversed, when it was produced by an undo.
    //
    // Without it an undo is indistinguishable from ordinary work in the activity
    // feed: undoing a card creation appended a plain `card.delete`, which read as
    // "deleted a card" — not identifiable as an undo, and missing the card's name
    // because a delete takes its name from an inverse, and undos deliberately
    // record none.
    //
    // Restoring a column produces several operations; all of them carry the same
    // value, which is what lets the feed collapse them into one line.
    public long? UndoOfSeq { get; set; }

    public Board Board { get; set; } = null!;
}
