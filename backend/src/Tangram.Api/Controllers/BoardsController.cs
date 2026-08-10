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
    ICurrentUserService currentUser,
    IBoardOperationService boardOperations) : ControllerBase
{
    // The stages nearly every board starts with. Seeded only for the board the
    // bootstrap creates unasked -- see CreateBoardRequest.
    private static readonly string[] DefaultColumnNames = ["To Do", "In Progress", "Done"];

    // A ceiling on what the welcome flow can seed. Not a product rule -- columns
    // can be added freely afterwards -- just a bound so one request can't write
    // an unreasonable number of rows.
    private const int MaxSeededColumns = 8;

    [HttpGet("boards/{boardId:guid}/activity")]
    public async Task<ActionResult<ActivityResponse>> GetActivity(
        Guid boardId, CancellationToken ct, [FromQuery] int limit = 50)
    {
        try
        {
            return Ok(await boardOperations.GetActivityAsync(boardId, limit, ct));
        }
        catch (BoardOperationNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpPost("boards/{boardId:guid}/undo")]
    public async Task<IActionResult> Undo(Guid boardId, CancellationToken ct)
    {
        try
        {
            await boardOperations.UndoLastAsync(boardId, ct);
            return NoContent();
        }
        catch (BoardOperationNotFoundException)
        {
            return NotFound();
        }
        catch (BoardOperationForbiddenException)
        {
            return Forbid();
        }
        catch (BoardOperationConflictException ex)
        {
            // 409 rather than 404: the request was well-formed, the board just
            // moved on underneath it. The client maps this onto "someone else
            // changed this first", which is exactly what happened.
            return Problem(detail: ex.Message, statusCode: StatusCodes.Status409Conflict);
        }
    }

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

        // Previously unchecked: any member could create a board, including a
        // viewer who cannot then put anything on it. Same rule as every other
        // content mutation.
        if (await memberships.GetRoleAsync(workspaceId, currentUser.UserId, ct)
            is null or MembershipRole.Viewer)
        {
            return Forbid();
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

        // An explicit list wins; SeedDefaultColumns is the "just give me the
        // usual three" shorthand.
        var seedNames = request.Columns is { Count: > 0 }
            ? request.Columns.Select(n => n?.Trim() ?? string.Empty).Where(n => n.Length > 0).ToArray()
            : request.SeedDefaultColumns ? DefaultColumnNames : [];

        if (seedNames.Length > MaxSeededColumns)
        {
            return ValidationProblem($"A board can start with at most {MaxSeededColumns} columns.");
        }

        if (seedNames.Length > 0)
        {
            // Written directly, with no operations rows, and deliberately so.
            //
            // These used to be three ordinary API calls made by the client on
            // the user's behalf, which meant the log recorded them as work the
            // user did. Two things followed: the activity feed opened by
            // claiming someone added columns they had never touched, and undo
            // offered to reverse them. Since an undo carries no inverse, three
            // curious presses of Ctrl+Z stripped a brand-new board to nothing
            // with no way back.
            //
            // Scaffolding is not user work, so it does not go in the log. Board
            // seq stays 0 and resync is unaffected -- nobody can be connected to
            // a board that did not exist a moment ago.
            string? previous = null;
            foreach (var name in seedNames)
            {
                previous = RankService.GenerateBetween(previous, null);
                db.Columns.Add(new Column
                {
                    Id = Guid.NewGuid(),
                    BoardId = board.Id,
                    Name = name,
                    Rank = previous,
                    CreatedAt = now,
                    UpdatedAt = now
                });
            }
        }

        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetBoard), new { boardId = board.Id },
            new BoardResponse(board.Id, board.WorkspaceId, board.Name, board.CreatedAt));
    }

    [HttpPatch("boards/{boardId:guid}")]
    public async Task<ActionResult<BoardResponse>> RenameBoard(
        Guid boardId, RenameBoardRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationProblem("Board name is required.");
        }

        var board = await db.Boards.FirstOrDefaultAsync(b => b.Id == boardId, ct);
        if (board is null) return NotFound();

        // Renaming a board is a board-level edit, so it follows the same rule as
        // renaming a column: editors and owners, not viewers.
        if (await memberships.GetRoleAsync(board.WorkspaceId, currentUser.UserId, ct)
            is null or MembershipRole.Viewer)
        {
            return Forbid();
        }

        board.Name = request.Name.Trim();
        board.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return Ok(new BoardResponse(board.Id, board.WorkspaceId, board.Name, board.CreatedAt));
    }

    [HttpPost("boards/{boardId:guid}/archive")]
    public Task<IActionResult> ArchiveBoard(Guid boardId, CancellationToken ct) =>
        SetArchivedAsync(boardId, archived: true, ct);

    [HttpPost("boards/{boardId:guid}/unarchive")]
    public Task<IActionResult> UnarchiveBoard(Guid boardId, CancellationToken ct) =>
        SetArchivedAsync(boardId, archived: false, ct);

    /// <remarks>
    /// Owner-only, unlike renaming. Archiving changes what the whole workspace
    /// sees on its home screen rather than editing content inside one board,
    /// which puts it with the other membership-shaped decisions.
    /// </remarks>
    private async Task<IActionResult> SetArchivedAsync(Guid boardId, bool archived, CancellationToken ct)
    {
        var board = await db.Boards.FirstOrDefaultAsync(b => b.Id == boardId, ct);
        if (board is null) return NotFound();

        if (await memberships.GetRoleAsync(board.WorkspaceId, currentUser.UserId, ct) != MembershipRole.Owner)
        {
            return Forbid();
        }

        if (archived)
        {
            // A workspace must keep somewhere to work, the same way it must keep
            // an owner. Archiving the last active board leaves a home screen
            // whose only option is to create one, and no way back into the work
            // that was there.
            var otherActive = await db.Boards
                .AnyAsync(b => b.WorkspaceId == board.WorkspaceId && b.Id != boardId && b.ArchivedAt == null, ct);

            if (!otherActive)
            {
                return Problem(
                    detail: "This is the workspace's only active board. Create another one before archiving this.",
                    statusCode: StatusCodes.Status400BadRequest);
            }
        }

        board.ArchivedAt = archived ? DateTimeOffset.UtcNow : null;
        board.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return NoContent();
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
                    .Select(card => new CardResponse(card.Id, card.ColumnId, card.Title, card.Description, card.Rank, card.DueAt, card.AssigneeId))
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
