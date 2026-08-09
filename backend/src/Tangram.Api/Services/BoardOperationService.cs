using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;
using Tangram.Api.Hubs;

namespace Tangram.Api.Services;

public class BoardOperationNotFoundException(string message) : Exception(message);
public class BoardOperationForbiddenException(string message) : Exception(message);

// The server-authoritative sync spine (Architecture D3): every mutation goes
// through the same pipeline -- authorize -> validate -> assign the next
// board seq (txn) -> persist -> append an operations row -> broadcast to the
// board's SignalR group. Shared by every column/card mutation so REST and
// (later) hub-invoked paths always produce the same broadcast shape.
public interface IBoardOperationService
{
    Task<ColumnResponse> CreateColumnAsync(Guid boardId, string name, CancellationToken ct);
    Task<ColumnResponse> RenameColumnAsync(Guid boardId, Guid columnId, string name, CancellationToken ct);
    Task DeleteColumnAsync(Guid boardId, Guid columnId, CancellationToken ct);
    Task<ColumnResponse> MoveColumnAsync(Guid boardId, Guid columnId, Guid? beforeColumnId, CancellationToken ct);

    Task<CardResponse> CreateCardAsync(Guid boardId, Guid columnId, string title, string? description, CancellationToken ct);
    Task<CardResponse> UpdateCardAsync(Guid boardId, Guid cardId, UpdateCardRequest request, CancellationToken ct);
    Task DeleteCardAsync(Guid boardId, Guid cardId, CancellationToken ct);
    Task<CardResponse> MoveCardAsync(Guid boardId, Guid cardId, Guid targetColumnId, Guid? beforeCardId, CancellationToken ct);

    Task<ActivityResponse> GetActivityAsync(Guid boardId, int limit, CancellationToken ct);
    Task UndoLastAsync(Guid boardId, CancellationToken ct);
}

// Raised when what an undo would act on is no longer there -- someone else
// deleted the card, or removed the column it lived in. Surfaces as 409 rather
// than 404: the request was well-formed and the board simply moved on.
public class BoardOperationConflictException(string message) : Exception(message);

public class BoardOperationService(
    AppDbContext db,
    IHubContext<BoardHub> hubContext,
    ICurrentUserService currentUser,
    IMembershipService memberships) : IBoardOperationService
{
    public async Task<ColumnResponse> CreateColumnAsync(Guid boardId, string name, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var boardExists = await db.Boards.AnyAsync(b => b.Id == boardId, ct);
        if (!boardExists)
        {
            throw new BoardOperationNotFoundException("Board not found.");
        }

        var lastRank = await db.Columns
            .Where(c => c.BoardId == boardId)
            .OrderByDescending(c => c.Rank)
            .Select(c => c.Rank)
            .FirstOrDefaultAsync(ct);

        var now = DateTimeOffset.UtcNow;
        var column = new Column
        {
            Id = Guid.NewGuid(),
            BoardId = boardId,
            Name = name,
            Rank = RankService.GenerateBetween(lastRank, null),
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Columns.Add(column);

        var response = new ColumnResponse(column.Id, column.BoardId, column.Name, column.Rank);
        await SaveAsync(boardId, new Pending("column.create", response, "column.remove", new ColumnDeletedPayload(column.Id)), ct);
        return response;
    }

    public async Task<ColumnResponse> RenameColumnAsync(Guid boardId, Guid columnId, string name, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var column = await LoadColumnOnBoardAsync(boardId, columnId, ct);
        // Captured before the assignment below. After it the old name is gone,
        // and the operation payload only ever records the new one.
        var before = new ColumnResponse(column.Id, column.BoardId, column.Name, column.Rank);

        column.Name = name;
        column.UpdatedAt = DateTimeOffset.UtcNow;

        var response = new ColumnResponse(column.Id, column.BoardId, column.Name, column.Rank);
        await SaveAsync(boardId, new Pending("column.rename", response, "column.rename", before), ct);
        return response;
    }

    public async Task DeleteColumnAsync(Guid boardId, Guid columnId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var column = await LoadColumnOnBoardAsync(boardId, columnId, ct);

        // The cascade below takes the cards with it, and nothing else records
        // them. Snapshot first, or undoing a column deletion restores an empty
        // column and quietly loses the work it held -- which is exactly the
        // deletion people most want back.
        var cards = await db.Cards
            .Where(c => c.ColumnId == columnId)
            .OrderBy(c => c.Rank)
            .Select(c => new CardResponse(c.Id, c.ColumnId, c.Title, c.Description, c.Rank, c.DueAt, c.AssigneeId))
            .ToListAsync(ct);

        db.Columns.Remove(column); // DB FK cascade removes contained cards.

        await SaveAsync(
            boardId,
            new Pending(
                "column.delete",
                new ColumnDeletedPayload(columnId),
                "column.restore",
                new ColumnSnapshot(column.Id, column.BoardId, column.Name, column.Rank, cards)),
            ct);
    }

    public async Task<ColumnResponse> MoveColumnAsync(Guid boardId, Guid columnId, Guid? beforeColumnId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var column = await LoadColumnOnBoardAsync(boardId, columnId, ct);
        var before = new ColumnResponse(column.Id, column.BoardId, column.Name, column.Rank);

        var siblings = await db.Columns
            .Where(c => c.BoardId == boardId && c.Id != columnId)
            .OrderBy(c => c.Rank)
            .Select(c => new { c.Id, c.Rank })
            .ToListAsync(ct);

        var (lower, upper) = ResolveNeighborRanks(
            siblings.Select(s => (s.Id, s.Rank)).ToList(), beforeColumnId);

        column.Rank = RankService.GenerateBetween(lower, upper);
        column.UpdatedAt = DateTimeOffset.UtcNow;

        var response = new ColumnResponse(column.Id, column.BoardId, column.Name, column.Rank);
        await SaveAsync(boardId, new Pending("column.move", response, "column.move", before), ct);
        return response;
    }

    public async Task<CardResponse> CreateCardAsync(Guid boardId, Guid columnId, string title, string? description, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var column = await LoadColumnOnBoardAsync(boardId, columnId, ct);

        var lastRank = await db.Cards
            .Where(c => c.ColumnId == columnId)
            .OrderByDescending(c => c.Rank)
            .Select(c => c.Rank)
            .FirstOrDefaultAsync(ct);

        var now = DateTimeOffset.UtcNow;
        var card = new Card
        {
            Id = Guid.NewGuid(),
            ColumnId = column.Id,
            Title = title,
            Description = description,
            Rank = RankService.GenerateBetween(lastRank, null),
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Cards.Add(card);

        var response = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt, card.AssigneeId);
        await SaveAsync(boardId, new Pending("card.create", response, "card.remove", new CardDeletedPayload(card.Id, card.ColumnId)), ct);
        return response;
    }

    public async Task<CardResponse> UpdateCardAsync(
        Guid boardId, Guid cardId, UpdateCardRequest request, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var card = await LoadCardOnBoardAsync(boardId, cardId, ct);
        var before = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt, card.AssigneeId);

        if (request.Title is not null)
        {
            card.Title = request.Title;
        }

        // Description has always been nullable and the panel always sends it,
        // so an omitted description keeps meaning "no description" here.
        card.Description = request.Description;

        if (request.ClearDueAt)
        {
            card.DueAt = null;
        }
        else if (request.DueAt is not null)
        {
            // Normalized to UTC midnight. A due date is a day, not a moment;
            // keeping the submitted time would let two people in different
            // zones disagree about whether the same card is overdue.
            card.DueAt = new DateTimeOffset(request.DueAt.Value.UtcDateTime.Date, TimeSpan.Zero);
        }

        if (request.ClearAssignee)
        {
            card.AssigneeId = null;
        }
        else if (request.AssigneeId is not null)
        {
            // Assigning someone outside the workspace would put a name on the
            // card that nobody there can resolve, so it is refused rather than
            // stored and rendered as a blank avatar.
            var workspaceId = await db.Boards
                .Where(b => b.Id == boardId)
                .Select(b => b.WorkspaceId)
                .FirstAsync(ct);

            var isMember = await memberships.GetRoleAsync(workspaceId, request.AssigneeId.Value, ct) is not null;
            if (!isMember)
            {
                throw new BoardOperationConflictException(
                    "That person isn't a member of this workspace any more.");
            }

            card.AssigneeId = request.AssigneeId;
        }

        card.UpdatedAt = DateTimeOffset.UtcNow;

        var response = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt, card.AssigneeId);
        // Still emitted as "card.rename" rather than a new op type: the
        // operations log holds historical card.rename rows that resync replays,
        // so introducing card.update would mean every client had to understand
        // both forever. The payload is a whole card either way.
        await SaveAsync(boardId, new Pending("card.rename", response, "card.rename", before), ct);
        return response;
    }

    public async Task DeleteCardAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var card = await LoadCardOnBoardAsync(boardId, cardId, ct);
        var columnId = card.ColumnId;
        var snapshot = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt, card.AssigneeId);
        db.Cards.Remove(card);

        await SaveAsync(
            boardId,
            new Pending("card.delete", new CardDeletedPayload(cardId, columnId), "card.restore", snapshot),
            ct);
    }

    public async Task<CardResponse> MoveCardAsync(Guid boardId, Guid cardId, Guid targetColumnId, Guid? beforeCardId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var card = await LoadCardOnBoardAsync(boardId, cardId, ct);
        var before = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt, card.AssigneeId);
        var targetColumn = await LoadColumnOnBoardAsync(boardId, targetColumnId, ct);

        var siblings = await db.Cards
            .Where(c => c.ColumnId == targetColumn.Id && c.Id != cardId)
            .OrderBy(c => c.Rank)
            .Select(c => new { c.Id, c.Rank })
            .ToListAsync(ct);

        var (lower, upper) = ResolveNeighborRanks(
            siblings.Select(s => (s.Id, s.Rank)).ToList(), beforeCardId);

        card.ColumnId = targetColumn.Id;
        card.Rank = RankService.GenerateBetween(lower, upper);
        card.UpdatedAt = DateTimeOffset.UtcNow;

        var response = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt, card.AssigneeId);
        await SaveAsync(boardId, new Pending("card.move", response, "card.move", before), ct);
        return response;
    }

    public async Task<ActivityResponse> GetActivityAsync(Guid boardId, int limit, CancellationToken ct)
    {
        // Read access, not write: viewers can watch the board, so they can see
        // its history. The query filter has already excluded boards in
        // workspaces the caller isn't a member of.
        var boardExists = await db.Boards.AnyAsync(b => b.Id == boardId, ct);
        if (!boardExists)
        {
            throw new BoardOperationNotFoundException("Board not found.");
        }

        var rows = await db.Operations
            .Where(o => o.BoardId == boardId)
            .OrderByDescending(o => o.Seq)
            .Take(Math.Clamp(limit, 1, 200))
            .Join(db.Users, o => o.ActorId, u => u.Id, (o, u) => new
            {
                o.Seq,
                o.OpType,
                o.ActorId,
                ActorName = u.DisplayName,
                o.Payload,
                o.InverseOpType,
                o.InversePayload,
                o.CreatedAt,
                o.UndoneAt
            })
            .ToListAsync(ct);

        var me = currentUser.UserId;
        var entries = rows
            .Select(r => new ActivityEntry(
                r.Seq,
                r.OpType,
                r.ActorId,
                r.ActorName,
                Summarize(r.OpType, r.Payload, r.InversePayload),
                r.CreatedAt,
                r.UndoneAt is not null,
                // Only your own, and only what has an inverse. Reversing someone
                // else's edit out from under them is a different feature with a
                // different conversation attached.
                r.UndoneAt is null && r.InverseOpType is not null && r.ActorId == me))
            .ToList();

        return new ActivityResponse(entries, entries.FirstOrDefault(e => e.CanUndo)?.Seq);
    }

    public async Task UndoLastAsync(Guid boardId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var me = currentUser.UserId;
        var target = await db.Operations
            .Where(o => o.BoardId == boardId
                && o.ActorId == me
                && o.UndoneAt == null
                && o.InverseOpType != null)
            .OrderByDescending(o => o.Seq)
            .FirstOrDefaultAsync(ct);

        if (target is null)
        {
            throw new BoardOperationConflictException("There's nothing of yours left to undo.");
        }

        var ops = await BuildUndoAsync(boardId, target.InverseOpType!, target.InversePayload!, ct);
        await SaveAsync(boardId, ops, target, ct);
    }

    /// <summary>
    /// Turns a stored inverse into the changes that reverse it.
    /// </summary>
    /// <remarks>
    /// The inverse vocabulary is deliberately internal — <c>card.restore</c> and
    /// <c>column.restore</c> never reach a client. Restores are broadcast as
    /// ordinary <c>create</c> operations carrying the original id, which the
    /// client reducer already handles by replacing state by id. That keeps undo
    /// from adding a single new case to the frontend.
    /// </remarks>
    private async Task<List<Pending>> BuildUndoAsync(
        Guid boardId, string inverseOpType, string inversePayload, CancellationToken ct)
    {
        switch (inverseOpType)
        {
            case "card.remove":
            {
                var p = Deserialize<CardDeletedPayload>(inversePayload);
                var card = await db.Cards.FirstOrDefaultAsync(c => c.Id == p.Id, ct)
                    ?? throw Conflict("That card has already been deleted.");
                db.Cards.Remove(card);
                return [new Pending("card.delete", new CardDeletedPayload(p.Id, p.ColumnId))];
            }

            case "card.restore":
            {
                var p = Deserialize<CardResponse>(inversePayload);
                var columnStillThere = await db.Columns
                    .AnyAsync(c => c.Id == p.ColumnId && c.BoardId == boardId, ct);
                if (!columnStillThere)
                {
                    throw Conflict("The column that card was in has since been deleted.");
                }

                var now = DateTimeOffset.UtcNow;
                db.Cards.Add(new Card
                {
                    Id = p.Id,
                    ColumnId = p.ColumnId,
                    Title = p.Title,
                    Description = p.Description,
                    Rank = p.Rank,
                    DueAt = p.DueAt,
                    AssigneeId = p.AssigneeId,
                    CreatedAt = now,
                    UpdatedAt = now
                });
                return [new Pending("card.create", p)];
            }

            case "card.rename":
            {
                var p = Deserialize<CardResponse>(inversePayload);
                var card = await LoadCardOrConflictAsync(boardId, p.Id, ct);
                card.Title = p.Title;
                card.Description = p.Description;
                // The whole card, not just its text: undoing an edit that set a
                // due date has to clear it again.
                card.DueAt = p.DueAt;
                card.AssigneeId = p.AssigneeId;
                card.UpdatedAt = DateTimeOffset.UtcNow;
                return [new Pending("card.rename", new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt, card.AssigneeId))];
            }

            case "card.move":
            {
                var p = Deserialize<CardResponse>(inversePayload);
                var card = await LoadCardOrConflictAsync(boardId, p.Id, ct);
                var columnStillThere = await db.Columns
                    .AnyAsync(c => c.Id == p.ColumnId && c.BoardId == boardId, ct);
                if (!columnStillThere)
                {
                    throw Conflict("The column that card came from has since been deleted.");
                }

                card.ColumnId = p.ColumnId;
                card.Rank = p.Rank;
                card.UpdatedAt = DateTimeOffset.UtcNow;
                return [new Pending("card.move", new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt, card.AssigneeId))];
            }

            case "column.remove":
            {
                var p = Deserialize<ColumnDeletedPayload>(inversePayload);
                var column = await db.Columns.FirstOrDefaultAsync(c => c.Id == p.Id, ct)
                    ?? throw Conflict("That column has already been deleted.");
                db.Columns.Remove(column);
                return [new Pending("column.delete", new ColumnDeletedPayload(p.Id))];
            }

            case "column.restore":
            {
                var p = Deserialize<ColumnSnapshot>(inversePayload);
                var now = DateTimeOffset.UtcNow;

                db.Columns.Add(new Column
                {
                    Id = p.Id,
                    BoardId = p.BoardId,
                    Name = p.Name,
                    Rank = p.Rank,
                    CreatedAt = now,
                    UpdatedAt = now
                });

                // The column first, then its cards: each is broadcast in turn,
                // and a client that received a card for a column it doesn't yet
                // know about would drop it.
                var ops = new List<Pending>
                {
                    new("column.create", new ColumnResponse(p.Id, p.BoardId, p.Name, p.Rank))
                };

                foreach (var card in p.Cards)
                {
                    db.Cards.Add(new Card
                    {
                        Id = card.Id,
                        ColumnId = card.ColumnId,
                        Title = card.Title,
                        Description = card.Description,
                        Rank = card.Rank,
                        DueAt = card.DueAt,
                        AssigneeId = card.AssigneeId,
                        CreatedAt = now,
                        UpdatedAt = now
                    });
                    ops.Add(new Pending("card.create", card));
                }

                return ops;
            }

            case "column.rename":
            {
                var p = Deserialize<ColumnResponse>(inversePayload);
                var column = await LoadColumnOrConflictAsync(boardId, p.Id, ct);
                column.Name = p.Name;
                column.UpdatedAt = DateTimeOffset.UtcNow;
                return [new Pending("column.rename", new ColumnResponse(column.Id, column.BoardId, column.Name, column.Rank))];
            }

            case "column.move":
            {
                var p = Deserialize<ColumnResponse>(inversePayload);
                var column = await LoadColumnOrConflictAsync(boardId, p.Id, ct);
                column.Rank = p.Rank;
                column.UpdatedAt = DateTimeOffset.UtcNow;
                return [new Pending("column.move", new ColumnResponse(column.Id, column.BoardId, column.Name, column.Rank))];
            }

            default:
                // Reached only if an inverse type is added above without a case
                // here. Loud rather than silent: a no-op undo that reports
                // success is the worst outcome available.
                throw new InvalidOperationException($"No undo defined for inverse type '{inverseOpType}'.");
        }
    }

    private async Task<Card> LoadCardOrConflictAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        var card = await db.Cards.Include(c => c.Column).FirstOrDefaultAsync(c => c.Id == cardId, ct);
        if (card is null || card.Column.BoardId != boardId)
        {
            throw Conflict("That card has since been deleted.");
        }
        return card;
    }

    private async Task<Column> LoadColumnOrConflictAsync(Guid boardId, Guid columnId, CancellationToken ct)
    {
        var column = await db.Columns.FirstOrDefaultAsync(c => c.Id == columnId, ct);
        if (column is null || column.BoardId != boardId)
        {
            throw Conflict("That column has since been deleted.");
        }
        return column;
    }

    private static BoardOperationConflictException Conflict(string message) => new(message);

    private static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, JsonOptions)
        ?? throw new InvalidOperationException($"Stored payload could not be read as {typeof(T).Name}.");

    // Operations were serialized with the default (PascalCase) options, but the
    // API's own JSON pipeline is camelCase. Reading them back needs to accept
    // either, or every payload written before this became unreadable.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private static string Quote(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "an untitled item" : $"“{value.Trim()}”";

    /// <summary>
    /// A short past-tense description of one operation, for the activity feed.
    /// </summary>
    /// <remarks>
    /// Composed here rather than on the client because the client cannot: a
    /// delete's payload carries only ids, and the name worth showing lives in
    /// the inverse that was recorded alongside it.
    /// </remarks>
    private static string Summarize(string opType, string payload, string? inversePayload)
    {
        try
        {
            switch (opType)
            {
                case "card.create":
                    return $"added {Quote(Deserialize<CardResponse>(payload).Title)}";
                case "card.rename":
                    return $"edited {Quote(Deserialize<CardResponse>(payload).Title)}";
                case "card.move":
                    return $"moved {Quote(Deserialize<CardResponse>(payload).Title)}";
                case "card.delete":
                    return inversePayload is null
                        ? "deleted a card"
                        : $"deleted {Quote(Deserialize<CardResponse>(inversePayload).Title)}";
                case "column.create":
                    return $"added the {Quote(Deserialize<ColumnResponse>(payload).Name)} column";
                case "column.rename":
                    return $"renamed a column to {Quote(Deserialize<ColumnResponse>(payload).Name)}";
                case "column.move":
                    return $"reordered the {Quote(Deserialize<ColumnResponse>(payload).Name)} column";
                case "column.delete":
                    return inversePayload is null
                        ? "deleted a column"
                        : $"deleted the {Quote(Deserialize<ColumnSnapshot>(inversePayload).Name)} column";
                default:
                    return "changed the board";
            }
        }
        catch (JsonException)
        {
            // A feed entry is not worth failing the whole request over. The row
            // still shows who and when, which is most of its value.
            return "changed the board";
        }
    }

    private async Task<Column> LoadColumnOnBoardAsync(Guid boardId, Guid columnId, CancellationToken ct)
    {
        var column = await db.Columns.FirstOrDefaultAsync(c => c.Id == columnId, ct);
        if (column is null || column.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Column not found on this board.");
        }
        return column;
    }

    private async Task<Card> LoadCardOnBoardAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        var card = await db.Cards.Include(c => c.Column).FirstOrDefaultAsync(c => c.Id == cardId, ct);
        if (card is null || card.Column.BoardId != boardId)
        {
            throw new BoardOperationNotFoundException("Card not found on this board.");
        }
        return card;
    }

    // Given siblings ordered by rank and the id of the item the moved entity
    // should land before (null = end of the list), returns the ranks
    // immediately below and above the target gap for RankService to fill.
    private static (string? Lower, string? Upper) ResolveNeighborRanks(
        List<(Guid Id, string Rank)> orderedSiblings, Guid? beforeId)
    {
        if (beforeId is null)
        {
            return (orderedSiblings.Count > 0 ? orderedSiblings[^1].Rank : null, null);
        }

        var index = orderedSiblings.FindIndex(s => s.Id == beforeId);
        if (index < 0)
        {
            throw new BoardOperationNotFoundException("Reference item for the move was not found.");
        }

        var upper = orderedSiblings[index].Rank;
        var lower = index > 0 ? orderedSiblings[index - 1].Rank : null;
        return (lower, upper);
    }

    // One broadcastable change, plus how to reverse it. `InverseOpType` null
    // means "not undoable", which is how an undo itself is recorded -- storing
    // an inverse for it would turn undo into redo, and then into a loop.
    private sealed record Pending(
        string OpType,
        object Payload,
        string? InverseOpType = null,
        object? InversePayload = null);

    private Task SaveAsync(Guid boardId, Pending op, CancellationToken ct) =>
        SaveAsync(boardId, [op], null, ct);

    /// <summary>
    /// Appends operations, each with its own board <c>seq</c>, and broadcasts
    /// them. Takes a list because undoing a column deletion is genuinely several
    /// changes -- the column and every card that was inside it -- and they must
    /// land in one transaction or a failure halfway leaves a column back but its
    /// cards gone.
    /// </summary>
    private async Task SaveAsync(
        Guid boardId,
        IReadOnlyList<Pending> ops,
        Operation? markUndone,
        CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var assigned = new List<(long Seq, Pending Op)>(ops.Count);
        foreach (var op in ops)
        {
            // UPDATE ... RETURNING isn't composable SQL, so materialize it
            // directly rather than letting EF try to layer a Single()-style
            // query on top.
            var newSeqRows = await db.Database
                .SqlQuery<long>($"UPDATE boards SET seq = seq + 1 WHERE id = {boardId} RETURNING seq")
                .ToListAsync(ct);
            var newSeq = newSeqRows.Single();

            db.Operations.Add(new Operation
            {
                Id = Guid.NewGuid(),
                BoardId = boardId,
                Seq = newSeq,
                OpType = op.OpType,
                Payload = JsonSerializer.Serialize(op.Payload),
                InverseOpType = op.InverseOpType,
                InversePayload = op.InversePayload is null
                    ? null
                    : JsonSerializer.Serialize(op.InversePayload),
                ActorId = currentUser.UserId,
                CreatedAt = DateTimeOffset.UtcNow
            });

            assigned.Add((newSeq, op));
        }

        if (markUndone is not null)
        {
            markUndone.UndoneAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        // Broadcast only after the commit. Sending inside the transaction would
        // publish a change that a rollback then erases, and clients have no way
        // to learn that it never happened.
        foreach (var (seq, op) in assigned)
        {
            await hubContext.Clients
                .Group(BoardHub.GroupName(boardId))
                .SendAsync("operation", new OperationBroadcast(seq, op.OpType, op.Payload), ct);
        }
    }

    // Only an owner/editor membership in the board's workspace may mutate it.
    // Role resolution is delegated to IMembershipService so this and the
    // workspace member endpoints share one RBAC definition.
    private async Task EnsureCanMutateAsync(Guid boardId, CancellationToken ct)
    {
        var workspaceId = await db.Boards
            .Where(b => b.Id == boardId)
            .Select(b => b.WorkspaceId)
            .FirstOrDefaultAsync(ct);

        if (workspaceId == Guid.Empty)
        {
            throw new BoardOperationNotFoundException("Board not found.");
        }

        var role = await memberships.GetRoleAsync(workspaceId, currentUser.UserId, ct);

        if (role is null or MembershipRole.Viewer)
        {
            throw new BoardOperationForbiddenException("Viewers cannot modify the board.");
        }
    }
}
