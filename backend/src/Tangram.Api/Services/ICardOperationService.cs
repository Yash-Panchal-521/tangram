using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;
using Tangram.Api.Hubs;

namespace Tangram.Api.Services;

public class CardOperationNotFoundException(string message) : Exception(message);

// The server-authoritative sync spine (Architecture D3), shared by the REST
// create-card endpoint and the hub's CreateCard method so both paths produce
// the exact same broadcast: validate -> assign next board seq (txn) ->
// persist -> append operations row -> broadcast to the board group.
public interface ICardOperationService
{
    Task<CardResponse> CreateCardAsync(Guid boardId, Guid columnId, string title, string? description, CancellationToken ct);
}

public class CardOperationService(
    AppDbContext db,
    IHubContext<BoardHub> hubContext,
    ICurrentUserService currentUser) : ICardOperationService
{
    public async Task<CardResponse> CreateCardAsync(Guid boardId, Guid columnId, string title, string? description, CancellationToken ct)
    {
        var column = await db.Columns.FirstOrDefaultAsync(c => c.Id == columnId, ct);
        if (column is null || column.BoardId != boardId)
        {
            throw new CardOperationNotFoundException("Column not found on this board.");
        }

        var lastRank = await db.Cards
            .Where(c => c.ColumnId == columnId)
            .OrderByDescending(c => c.Rank)
            .Select(c => c.Rank)
            .FirstOrDefaultAsync(ct);

        var rank = RankService.GenerateBetween(lastRank, null);
        var now = DateTimeOffset.UtcNow;

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        // UPDATE ... RETURNING isn't composable SQL, so materialize it directly
        // rather than letting EF try to layer a Single()-style query on top.
        var newSeqRows = await db.Database
            .SqlQuery<long>($"UPDATE boards SET seq = seq + 1 WHERE id = {boardId} RETURNING seq")
            .ToListAsync(ct);
        var newSeq = newSeqRows.Single();

        var card = new Card
        {
            Id = Guid.NewGuid(),
            ColumnId = columnId,
            Title = title,
            Description = description,
            Rank = rank,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Cards.Add(card);

        var response = new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank);

        db.Operations.Add(new Operation
        {
            Id = Guid.NewGuid(),
            BoardId = boardId,
            Seq = newSeq,
            OpType = "card.create",
            Payload = JsonSerializer.Serialize(response),
            ActorId = currentUser.UserId,
            CreatedAt = now
        });

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        await hubContext.Clients
            .Group(BoardHub.GroupName(boardId))
            .SendAsync("operation", new OperationBroadcast(newSeq, "card.create", response), ct);

        return response;
    }
}
