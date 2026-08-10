using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;
using Tangram.Api.Services;

namespace Tangram.Api.Controllers;

/// <summary>
/// Accepting and declining an invitation, by token.
/// </summary>
/// <remarks>
/// Membership used to be granted silently by matching the caller's email
/// against pending invitations on every request. Nothing here verifies an email
/// address — Firebase treats a password sign-up as unverified — so knowing an
/// invited address was enough to take somebody else's invitation. The token is
/// the fix: it is a secret the owner chooses to share, and it is now the only
/// thing that grants membership.
///
/// It also gives the invitee a say. Being added to a workspace puts your name
/// and address in front of its owners; that should be a decision, not something
/// you discover.
/// </remarks>
[ApiController]
[Route("invitations")]
public class InvitationsController(AppDbContext db, ICurrentUserService currentUser) : ControllerBase
{
    private const int TokenBytes = 32;

    /// <summary>A URL-safe secret with 256 bits of entropy.</summary>
    public static string NewToken() =>
        Base64UrlEncode(RandomNumberGenerator.GetBytes(TokenBytes));

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>
    /// What is being offered, for the page that asks whether you want it.
    /// </summary>
    /// <remarks>
    /// Anonymous on purpose: the invitee has to be able to read the offer before
    /// deciding whether to create an account for it. Holding the token is
    /// already the thing that grants access to this much, and the response
    /// deliberately carries nothing about the board's contents.
    /// </remarks>
    [HttpGet("{token}")]
    [AllowAnonymous]
    public async Task<ActionResult<InvitationOfferResponse>> GetOffer(string token, CancellationToken ct)
    {
        var offer = await db.Invitations
            .IgnoreQueryFilters() // The invitee is not a member yet, so the tenant filter would hide their own invitation.
            .Where(i => i.Token == token)
            .Select(i => new
            {
                i.WorkspaceId,
                WorkspaceName = i.Workspace.Name,
                i.Role,
                i.AcceptedAt,
                i.DeclinedAt,
                i.ExpiresAt,
                i.InvitedByUserId
            })
            .FirstOrDefaultAsync(ct);

        if (offer is null)
        {
            return NotFound();
        }

        var invitedBy = await db.Users
            .Where(u => u.Id == offer.InvitedByUserId)
            .Select(u => u.DisplayName)
            .FirstOrDefaultAsync(ct);

        return Ok(new InvitationOfferResponse(
            offer.WorkspaceName,
            offer.Role.ToString(),
            invitedBy ?? "Someone",
            StatusOf(offer.AcceptedAt, offer.DeclinedAt, offer.ExpiresAt),
            offer.ExpiresAt));
    }

    [HttpPost("{token}/accept")]
    [Authorize]
    public async Task<IActionResult> Accept(string token, CancellationToken ct)
    {
        var invitation = await db.Invitations
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(i => i.Token == token, ct);

        if (invitation is null)
        {
            return NotFound();
        }

        var status = StatusOf(invitation.AcceptedAt, invitation.DeclinedAt, invitation.ExpiresAt);
        if (status != "pending")
        {
            return Problem(
                detail: status switch
                {
                    "accepted" => "That invitation has already been used.",
                    "declined" => "That invitation was turned down. Ask for a new one.",
                    _ => "That invitation has expired. Ask for a new one.",
                },
                statusCode: StatusCodes.Status409Conflict);
        }

        // Already a member -- of this workspace, by some other route. Consume the
        // invitation rather than stacking a second membership, and report success
        // so the page can just send them to the board.
        var alreadyMember = await db.Memberships
            .IgnoreQueryFilters()
            .AnyAsync(m => m.WorkspaceId == invitation.WorkspaceId && m.UserId == currentUser.UserId, ct);

        if (!alreadyMember)
        {
            db.Memberships.Add(new Membership
            {
                Id = Guid.NewGuid(),
                WorkspaceId = invitation.WorkspaceId,
                UserId = currentUser.UserId,
                Role = invitation.Role,
                CreatedAt = DateTimeOffset.UtcNow
            });
        }

        invitation.AcceptedAt = DateTimeOffset.UtcNow;
        invitation.AcceptedByUserId = currentUser.UserId;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Two tabs accepting at once. The unique index on
            // (workspace_id, user_id) is the authority; the loser is still a
            // member, which is all the caller asked for.
        }

        return NoContent();
    }

    [HttpPost("{token}/decline")]
    [Authorize]
    public async Task<IActionResult> Decline(string token, CancellationToken ct)
    {
        var invitation = await db.Invitations
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(i => i.Token == token, ct);

        if (invitation is null)
        {
            return NotFound();
        }

        if (invitation.AcceptedAt is not null)
        {
            return Problem(
                detail: "That invitation has already been used.",
                statusCode: StatusCodes.Status409Conflict);
        }

        // Recorded rather than deleted: the row is the owner's audit trail, and
        // without a marker the invitation would simply be offered again.
        invitation.DeclinedAt ??= DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return NoContent();
    }

    private static string StatusOf(DateTimeOffset? acceptedAt, DateTimeOffset? declinedAt, DateTimeOffset expiresAt)
    {
        if (acceptedAt is not null) return "accepted";
        if (declinedAt is not null) return "declined";
        return expiresAt <= DateTimeOffset.UtcNow ? "expired" : "pending";
    }
}
