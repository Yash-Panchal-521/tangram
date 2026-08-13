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
// No IMembershipService here any more: every role question this controller asks
// is about the caller, and the caller's roles arrived with the request.
public class BoardsController(
    AppDbContext db,
    ICurrentUserService currentUser) : ControllerBase
{
    // The stages nearly every board starts with. Seeded only for the board the
    // bootstrap creates unasked -- see CreateBoardRequest.
    private static readonly string[] DefaultColumnNames = ["To Do", "In Progress", "Done"];

    // A ceiling on what the welcome flow can seed. Not a product rule -- columns
    // can be added freely afterwards -- just a bound so one request can't write
    // an unreasonable number of rows.
    private const int MaxSeededColumns = 8;

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
        if (currentUser.RoleIn(workspaceId) is null or MembershipRole.Viewer)
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
        if (currentUser.RoleIn(board.WorkspaceId) is null or MembershipRole.Viewer)
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

        if (currentUser.RoleIn(board.WorkspaceId) != MembershipRole.Owner)
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
            .ThenInclude(card => card.CardLabels)
            .ThenInclude(cl => cl.Label)
            .Include(b => b.Labels)
            .FirstOrDefaultAsync(b => b.Id == boardId, ct);

        if (board is null)
        {
            return NotFound();
        }

        // One grouped query for the whole board, rather than Include-ing every
        // comment on it. `card.Comments.Count` on an unloaded collection is
        // silently 0, which would put "no comments" on every card that has them
        // -- wrong in the direction nobody notices.
        var commentCounts = await db.Comments
            .Where(c => c.Card.Column.BoardId == boardId)
            .GroupBy(c => c.CardId)
            .Select(g => new { CardId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.CardId, x => x.Count, ct);

        var columns = board.Columns
            .OrderBy(c => c.Rank, StringComparer.Ordinal)
            .Select(c => new ColumnWithCardsResponse(
                c.Id,
                c.Name,
                c.Rank,
                c.Cards
                    .OrderBy(card => card.Rank, StringComparer.Ordinal)
                    .Select(card => new CardResponse(
                        card.Id, card.ColumnId, card.Title, card.Description, card.Rank,
                        card.DueAt, card.AssigneeId, card.CreatedAt, card.UpdatedAt,
                        card.Priority?.ToString(),
                        card.CardLabels
                            .Select(cl => new LabelResponse(cl.Label.Id, cl.Label.Name, cl.Label.Color))
                            .OrderBy(l => l.Name, StringComparer.OrdinalIgnoreCase)
                            .ToList(),
                        commentCounts.GetValueOrDefault(card.Id)))
                    .ToList(),
                c.MinCards,
                c.MaxCards))
            .ToList();

        // Reaching here already proves membership -- the workspace query filter
        // would have hidden the board otherwise. Falling back to Viewer rather
        // than throwing keeps the least-privileged reading if that ever changes.
        var role = currentUser.RoleIn(board.WorkspaceId) ?? MembershipRole.Viewer;

        return Ok(new BoardDetailResponse(
            board.Id, board.WorkspaceId, board.Name, role.ToString(), board.Seq, columns,
            board.Labels
                .Select(l => new LabelResponse(l.Id, l.Name, l.Color))
                .OrderBy(l => l.Name, StringComparer.OrdinalIgnoreCase)
                .ToList()));
    }
}
