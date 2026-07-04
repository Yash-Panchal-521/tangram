using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;

namespace Tangram.Api.Controllers;

[ApiController]
[Authorize]
[Route("boards/{boardId:guid}/columns")]
public class ColumnsController(AppDbContext db) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<ColumnResponse>> CreateColumn(Guid boardId, CreateColumnRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationProblem("Column name is required.");
        }

        var boardExists = await db.Boards.AnyAsync(b => b.Id == boardId, ct);
        if (!boardExists)
        {
            return NotFound();
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
            Name = request.Name.Trim(),
            Rank = Services.RankService.GenerateBetween(lastRank, null),
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Columns.Add(column);
        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(CreateColumn), new { boardId, id = column.Id },
            new ColumnResponse(column.Id, column.BoardId, column.Name, column.Rank));
    }
}
