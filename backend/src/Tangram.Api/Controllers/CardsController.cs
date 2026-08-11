using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Tangram.Api.Dtos;
using Tangram.Api.Services;

namespace Tangram.Api.Controllers;

[ApiController]
[Authorize]
[Route("boards/{boardId:guid}")]
public class CardsController(IBoardOperationService boardOperations) : ControllerBase
{
    [HttpPost("columns/{columnId:guid}/cards")]
    public async Task<ActionResult<CardResponse>> CreateCard(
        Guid boardId, Guid columnId, CreateCardRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return ValidationProblem("Card title is required.");
        }

        return await Run(() => boardOperations.CreateCardAsync(boardId, columnId, request.Title.Trim(), request.Description, ct));
    }

    [HttpPatch("cards/{cardId:guid}")]
    public async Task<ActionResult<CardResponse>> UpdateCard(
        Guid boardId, Guid cardId, UpdateCardRequest request, CancellationToken ct)
    {
        // A title may be omitted -- an edit that only sets a due date shouldn't
        // have to resend it -- but a title that is *present* and blank is a
        // request to erase the only thing identifying the card.
        if (request.Title is not null && string.IsNullOrWhiteSpace(request.Title))
        {
            return ValidationProblem("Card title is required.");
        }

        // A 400 rather than a coerced value: Enum.TryParse accepts any number,
        // so "7" would otherwise be stored as a priority nothing can render.
        if (request.Priority is not null && !CardPriorityParser.TryParse(request.Priority, out _))
        {
            return ValidationProblem($"Priority must be one of {CardPriorityParser.AllowedValues}.");
        }

        try
        {
            return Ok(await boardOperations.UpdateCardAsync(
                boardId, cardId, request with { Title = request.Title?.Trim() }, ct));
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

    [HttpDelete("cards/{cardId:guid}")]
    public async Task<IActionResult> DeleteCard(Guid boardId, Guid cardId, CancellationToken ct)
    {
        try
        {
            await boardOperations.DeleteCardAsync(boardId, cardId, ct);
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

    [HttpPost("cards/{cardId:guid}/move")]
    public async Task<ActionResult<CardResponse>> MoveCard(
        Guid boardId, Guid cardId, MoveCardRequest request, CancellationToken ct)
    {
        return await Run(() => boardOperations.MoveCardAsync(boardId, cardId, request.TargetColumnId, request.BeforeCardId, ct));
    }

    private async Task<ActionResult<CardResponse>> Run(Func<Task<CardResponse>> operation)
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
