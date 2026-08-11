using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Tangram.Api.Dtos;
using Tangram.Api.Services;

namespace Tangram.Api.Controllers;

/// <summary>
/// A board's label vocabulary.
/// </summary>
/// <remarks>
/// Putting a label *on a card* is not here — that is a field of the card and
/// goes through <c>PATCH /boards/{id}/cards/{id}</c> with the whole set, the way
/// an assignee does. This controller only manages which labels exist.
/// </remarks>
[ApiController]
[Authorize]
[Route("boards/{boardId:guid}/labels")]
public class LabelsController(IBoardOperationService boardOperations) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<LabelResponse>> CreateLabel(
        Guid boardId, CreateLabelRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationProblem("Label name is required.");
        }

        if (request.Color is not null && !LabelColors.IsValid(request.Color))
        {
            return ValidationProblem($"Label colour must be one of {LabelColors.AllowedValues}.");
        }

        return await Run(() => boardOperations.CreateLabelAsync(boardId, request.Name, request.Color, ct));
    }

    [HttpPatch("{labelId:guid}")]
    public async Task<ActionResult<LabelResponse>> UpdateLabel(
        Guid boardId, Guid labelId, UpdateLabelRequest request, CancellationToken ct)
    {
        // A name may be omitted -- recolouring shouldn't have to resend it --
        // but a name that is present and blank erases the only thing
        // identifying the label.
        if (request.Name is not null && string.IsNullOrWhiteSpace(request.Name))
        {
            return ValidationProblem("Label name is required.");
        }

        if (request.Color is not null && !LabelColors.IsValid(request.Color))
        {
            return ValidationProblem($"Label colour must be one of {LabelColors.AllowedValues}.");
        }

        return await Run(() => boardOperations.UpdateLabelAsync(boardId, labelId, request, ct));
    }

    [HttpDelete("{labelId:guid}")]
    public async Task<IActionResult> DeleteLabel(Guid boardId, Guid labelId, CancellationToken ct)
    {
        try
        {
            await boardOperations.DeleteLabelAsync(boardId, labelId, ct);
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

    private async Task<ActionResult<LabelResponse>> Run(Func<Task<LabelResponse>> operation)
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
        catch (BoardOperationConflictException ex)
        {
            return Problem(detail: ex.Message, statusCode: StatusCodes.Status409Conflict);
        }
    }
}
