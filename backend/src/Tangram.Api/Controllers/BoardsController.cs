using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;
using Tangram.Api.Services;

namespace Tangram.Api.Controllers;

[ApiController]
[Authorize]
public class BoardsController(
    AppDbContext db,
    IMembershipService memberships,
    ICurrentUserService currentUser) : ControllerBase
{
    [HttpPost("workspaces/{workspaceId:guid}/boards")]
    public async Task<ActionResult<BoardResponse>> CreateBoard(Guid workspaceId, CreateBoardRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationProblem("Board name is required.");
        }

        var workspaceExists = await db.Workspaces.AnyAsync(w => w.Id == workspaceId, ct);
        if (!workspaceExists)
        {
            return NotFound();
        }

        var now = DateTimeOffset.UtcNow;
        var board = new Board
        {
            Id = Guid.NewGuid(),
            WorkspaceId = workspaceId,
            Name = request.Name.Trim(),
            Seq = 0,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Boards.Add(board);
        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetBoard), new { boardId = board.Id },
            new BoardResponse(board.Id, board.WorkspaceId, board.Name, board.CreatedAt));
    }

    [HttpGet("boards/{boardId:guid}")]
    public async Task<ActionResult<BoardDetailResponse>> GetBoard(Guid boardId, CancellationToken ct)
    {
        var board = await db.Boards
            .Include(b => b.Columns)
            .ThenInclude(c => c.Cards)
            .FirstOrDefaultAsync(b => b.Id == boardId, ct);

        if (board is null)
        {
            return NotFound();
        }

        var columns = board.Columns
            .OrderBy(c => c.Rank, StringComparer.Ordinal)
            .Select(c => new ColumnWithCardsResponse(
                c.Id,
                c.Name,
                c.Rank,
                c.Cards
                    .OrderBy(card => card.Rank, StringComparer.Ordinal)
                    .Select(card => new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank))
                    .ToList()))
            .ToList();

        // Reaching here already proves membership -- the workspace query filter
        // would have hidden the board otherwise. Falling back to Viewer rather
        // than throwing keeps the least-privileged reading if that ever changes.
        var role = await memberships.GetRoleAsync(board.WorkspaceId, currentUser.UserId, ct)
            ?? MembershipRole.Viewer;

        return Ok(new BoardDetailResponse(
            board.Id, board.WorkspaceId, board.Name, role.ToString(), board.Seq, columns));
    }
}
