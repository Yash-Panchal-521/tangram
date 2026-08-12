using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Tangram.Api.Dtos;
using Tangram.Api.Services;

namespace Tangram.Api.Controllers;

[ApiController]
[Authorize]
[Route("boards/{boardId:guid}/columns")]
public class ColumnsController(IBoardOperationService boardOperations) : ControllerBase
{
    private const int MaxColumnsPerRequest = 8;

    [HttpPost]
    public async Task<ActionResult<ColumnResponse>> CreateColumn(Guid boardId, CreateColumnRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationProblem("Column name is required.");
        }

        return await Run(() => boardOperations.CreateColumnAsync(boardId, request.Name.Trim(), ct));
    }

    [HttpPost("bulk")]
    public async Task<ActionResult<List<ColumnResponse>>> CreateColumns(
        Guid boardId, CreateColumnsRequest request, CancellationToken ct)
    {
        var names = (request.Names ?? [])
            .Select(n => n?.Trim() ?? string.Empty)
            .Where(n => n.Length > 0)
            .ToList();

        if (names.Count == 0)
        {
            return ValidationProblem("Name at least one column.");
        }

        // The same ceiling board creation uses. Not a product rule so much as a
        // guard: a pasted paragraph would otherwise become forty columns and a
        // board nobody can read.
        if (names.Count > MaxColumnsPerRequest)
        {
            return ValidationProblem($"You can add at most {MaxColumnsPerRequest} columns at once.");
        }

        try
        {
            return await boardOperations.CreateColumnsAsync(boardId, names, ct);
        }
        catch (BoardOperationNotFoundException)
        {
            return NotFound();
        }
        catch (BoardOperationForbiddenException)
        {
            return Forbid();
        }
    }

    [HttpPatch("{columnId:guid}")]
    public async Task<ActionResult<ColumnResponse>> RenameColumn(Guid boardId, Guid columnId, RenameColumnRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationProblem("Column name is required.");
        }

        return await Run(() => boardOperations.RenameColumnAsync(boardId, columnId, request.Name.Trim(), ct));
    }

    [HttpPatch("{columnId:guid}/limits")]
    public async Task<ActionResult<ColumnResponse>> SetColumnLimits(
        Guid boardId, Guid columnId, SetColumnLimitsRequest request, CancellationToken ct)
    {
        // A negative limit is not a smaller limit, it is a typo. Zero is
        // allowed: "nothing should be in progress here" is a real thing to say.
        if (request.MinCards < 0 || request.MaxCards < 0)
        {
            return ValidationProblem("A card limit can't be negative.");
        }

        // Whether the minimum ends up above the maximum depends on what is
        // already stored, so that check lives in the service.
        try
        {
            return await Run(() => boardOperations.SetColumnLimitsAsync(boardId, columnId, request, ct));
        }
        catch (BoardOperationInvalidException ex)
        {
            return ValidationProblem(ex.Message);
        }
    }

    [HttpDelete("{columnId:guid}")]
    public async Task<IActionResult> DeleteColumn(Guid boardId, Guid columnId, CancellationToken ct)
    {
        try
        {
            await boardOperations.DeleteColumnAsync(boardId, columnId, ct);
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
    }

    [HttpPost("{columnId:guid}/move")]
    public async Task<ActionResult<ColumnResponse>> MoveColumn(Guid boardId, Guid columnId, MoveColumnRequest request, CancellationToken ct)
    {
        return await Run(() => boardOperations.MoveColumnAsync(boardId, columnId, request.BeforeColumnId, ct));
    }

    private async Task<ActionResult<ColumnResponse>> Run(Func<Task<ColumnResponse>> operation)
    {
        try
        {
            return await operation();
        }
        catch (BoardOperationNotFoundException)
        {
            return NotFound();
        }
        catch (BoardOperationForbiddenException)
        {
            return Forbid();
        }
    }
}
