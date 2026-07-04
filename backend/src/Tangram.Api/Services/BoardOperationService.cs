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
    Task<CardResponse> RenameCardAsync(Guid boardId, Guid cardId, string title, string? description, CancellationToken ct);
    Task DeleteCardAsync(Guid boardId, Guid cardId, CancellationToken ct);
    Task<CardResponse> MoveCardAsync(Guid boardId, Guid cardId, Guid targetColumnId, Guid? beforeCardId, CancellationToken ct);
}

public class BoardOperationService(
    AppDbContext db,
    IHubContext<BoardHub> hubContext,
    ICurrentUserService currentUser) : IBoardOperationService
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
        await SaveWithOperationAsync(boardId, "column.create", response, ct);
        return response;
    }

    public async Task<ColumnResponse> RenameColumnAsync(Guid boardId, Guid columnId, string name, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var column = await LoadColumnOnBoardAsync(boardId, columnId, ct);
        column.Name = name;
        column.UpdatedAt = DateTimeOffset.UtcNow;

        var response = new ColumnResponse(column.Id, column.BoardId, column.Name, column.Rank);
        await SaveWithOperationAsync(boardId, "column.rename", response, ct);
        return response;
    }

    public async Task DeleteColumnAsync(Guid boardId, Guid columnId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var column = await LoadColumnOnBoardAsync(boardId, columnId, ct);
        db.Columns.Remove(column); // DB FK cascade removes contained cards.

        await SaveWithOperationAsync(boardId, "column.delete", new ColumnDeletedPayload(columnId), ct);
    }

    public async Task<ColumnResponse> MoveColumnAsync(Guid boardId, Guid columnId, Guid? beforeColumnId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var column = await LoadColumnOnBoardAsync(boardId, columnId, ct);

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
        await SaveWithOperationAsync(boardId, "column.move", response, ct);
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

        var response = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank);
        await SaveWithOperationAsync(boardId, "card.create", response, ct);
        return response;
    }

    public async Task<CardResponse> RenameCardAsync(Guid boardId, Guid cardId, string title, string? description, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var card = await LoadCardOnBoardAsync(boardId, cardId, ct);
        card.Title = title;
        card.Description = description;
        card.UpdatedAt = DateTimeOffset.UtcNow;

        var response = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank);
        await SaveWithOperationAsync(boardId, "card.rename", response, ct);
        return response;
    }

    public async Task DeleteCardAsync(Guid boardId, Guid cardId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var card = await LoadCardOnBoardAsync(boardId, cardId, ct);
        var columnId = card.ColumnId;
        db.Cards.Remove(card);

        await SaveWithOperationAsync(boardId, "card.delete", new CardDeletedPayload(cardId, columnId), ct);
    }

    public async Task<CardResponse> MoveCardAsync(Guid boardId, Guid cardId, Guid targetColumnId, Guid? beforeCardId, CancellationToken ct)
    {
        await EnsureCanMutateAsync(boardId, ct);

        var card = await LoadCardOnBoardAsync(boardId, cardId, ct);
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

        var response = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank);
        await SaveWithOperationAsync(boardId, "card.move", response, ct);
        return response;
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

    private async Task SaveWithOperationAsync(Guid boardId, string opType, object payload, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

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
            OpType = opType,
            Payload = JsonSerializer.Serialize(payload),
            ActorId = currentUser.UserId,
            CreatedAt = DateTimeOffset.UtcNow
        });

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        await hubContext.Clients
            .Group(BoardHub.GroupName(boardId))
            .SendAsync("operation", new OperationBroadcast(newSeq, opType, payload), ct);
    }

    // Full RBAC (viewer UI + every-event enforcement) lands in Slice 4; this
    // is the authorization hook Slice 2 calls for -- only an owner/editor
    // membership in the board's workspace may mutate it.
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

        var role = await db.Memberships
            .Where(m => m.WorkspaceId == workspaceId && m.UserId == currentUser.UserId)
            .Select(m => (MembershipRole?)m.Role)
            .FirstOrDefaultAsync(ct);

        if (role is null or MembershipRole.Viewer)
        {
            throw new BoardOperationForbiddenException("Viewers cannot modify the board.");
        }
    }
}
