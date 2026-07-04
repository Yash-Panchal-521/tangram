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
    [HttpPost]
    public async Task<ActionResult<ColumnResponse>> CreateColumn(Guid boardId, CreateColumnRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationProblem("Column name is required.");
        }

        return await Run(() => boardOperations.CreateColumnAsync(boardId, request.Name.Trim(), ct));
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
