using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Tangram.Api.Dtos;
using Tangram.Api.Services;

namespace Tangram.Api.Controllers;

/// <summary>
/// The conversation on a card.
/// </summary>
/// <remarks>
/// A separate endpoint rather than a field on the card, unlike labels. A card's
/// labels are bounded and travel with it; its comments are not, and carrying
/// them on every card in the board payload would mean loading every thread on
/// the board to render it. The card carries a count; the thread is fetched when
/// somebody opens it.
/// </remarks>
[ApiController]
[Authorize]
[Route("boards/{boardId:guid}")]
public class CommentsController(IBoardOperationService boardOperations) : ControllerBase
{
    private const int MaxBodyLength = 5000;

    [HttpGet("cards/{cardId:guid}/comments")]
    public async Task<ActionResult<List<CommentResponse>>> GetComments(
        Guid boardId, Guid cardId, CancellationToken ct)
    {
        try
        {
            return Ok(await boardOperations.GetCommentsAsync(boardId, cardId, ct));
        }
        catch (BoardOperationNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpPost("cards/{cardId:guid}/comments")]
    public async Task<ActionResult<CommentResponse>> AddComment(
        Guid boardId, Guid cardId, CreateCommentRequest request, CancellationToken ct)
    {
        if (Invalid(request.Body, out var problem))
        {
            return problem;
        }

        return await Run(() => boardOperations.AddCommentAsync(boardId, cardId, request.Body.Trim(), ct));
    }

    [HttpPatch("comments/{commentId:guid}")]
    public async Task<ActionResult<CommentResponse>> EditComment(
        Guid boardId, Guid commentId, UpdateCommentRequest request, CancellationToken ct)
    {
        if (Invalid(request.Body, out var problem))
        {
            return problem;
        }

        return await Run(() => boardOperations.EditCommentAsync(boardId, commentId, request.Body.Trim(), ct));
    }

    [HttpDelete("comments/{commentId:guid}")]
    public async Task<IActionResult> DeleteComment(Guid boardId, Guid commentId, CancellationToken ct)
    {
        try
        {
            await boardOperations.DeleteCommentAsync(boardId, commentId, ct);
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

    private bool Invalid(string? body, out ActionResult problem)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            problem = ValidationProblem("A comment can't be empty.");
            return true;
        }

        // A ceiling rather than a product rule: without one, a single request
        // could write an unbounded row and the thread would be unreadable
        // anyway.
        if (body.Trim().Length > MaxBodyLength)
        {
            problem = ValidationProblem($"A comment can be at most {MaxBodyLength} characters.");
            return true;
        }

        problem = null!;
        return false;
    }

    private async Task<ActionResult<CommentResponse>> Run(Func<Task<CommentResponse>> operation)
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
