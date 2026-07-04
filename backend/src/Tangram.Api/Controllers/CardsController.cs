using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Tangram.Api.Dtos;
using Tangram.Api.Services;

namespace Tangram.Api.Controllers;

[ApiController]
[Authorize]
[Route("boards/{boardId:guid}/columns/{columnId:guid}/cards")]
public class CardsController(ICardOperationService cardOperations) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<CardResponse>> CreateCard(
        Guid boardId, Guid columnId, CreateCardRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return ValidationProblem("Card title is required.");
        }

        try
        {
            var card = await cardOperations.CreateCardAsync(boardId, columnId, request.Title.Trim(), request.Description, ct);
            return CreatedAtAction(nameof(CreateCard), new { boardId, columnId, id = card.Id }, card);
        }
        catch (CardOperationNotFoundException)
        {
            return NotFound();
        }
    }
}
