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
        await SaveAsync(boardId, new Pending("column.create", response), ct);
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
        await SaveAsync(boardId, new Pending("column.rename", response), ct);
        return response;
    }

    public async Task DeleteColumnAsync(Guid boardId, Guid columnId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var column = await LoadColumnOnBoardAsync(boardId, columnId, ct);

        db.Columns.Remove(column); // DB FK cascade removes contained cards.

        // The cards are gone with it and nothing records them. That was
        // survivable while undo existed and snapshotted them here; with undo
        // removed, deleting a column is final. The confirmation is what stands
        // between a person and that, so it has to keep naming the consequence.
        await SaveAsync(boardId, new Pending("column.delete", new ColumnDeletedPayload(columnId)), ct);
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
        await SaveAsync(boardId, new Pending("column.move", response), ct);
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
        await SaveAsync(boardId, new Pending("card.create", response), ct);
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
        await SaveAsync(boardId, new Pending("card.rename", response), ct);
        return response;
    }

    public async Task DeleteCardAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var card = await LoadCardOnBoardAsync(boardId, cardId, ct);
        var columnId = card.ColumnId;
        db.Cards.Remove(card);

        await SaveAsync(boardId, new Pending("card.delete", new CardDeletedPayload(cardId, columnId)), ct);
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
        await SaveAsync(boardId, new Pending("card.move", response), ct);
        return response;
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

    // One broadcastable change.
    private sealed record Pending(string OpType, object Payload);

    private Task SaveAsync(Guid boardId, Pending op, CancellationToken ct) =>
        SaveAsync(boardId, [op], ct);

    /// <summary>
    /// Appends operations, each with its own board <c>seq</c>, and broadcasts
    /// them. Still takes a list, and they still land in one transaction: a
    /// caller with several changes to make needs all or none of them, and the
    /// seq a client reconciles against must not advance for work that then
    /// rolls back.
    /// </summary>
    private async Task SaveAsync(
        Guid boardId,
        IReadOnlyList<Pending> ops,
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
                ActorId = currentUser.UserId,
                CreatedAt = DateTimeOffset.UtcNow
            });

            assigned.Add((newSeq, op));
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
