using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Dtos;
using Tangram.Api.Entities;
using Tangram.Api.Services;

namespace Tangram.Api.Controllers;

// Workspace membership management. Reading the roster is open to any member;
// every mutation is owner-only. Note that a caller who isn't a member at all
// never reaches the role check -- the workspace query filter hides the
// workspace entirely, so they get a 404 rather than a 403.
[ApiController]
[Authorize]
[Route("workspaces/{workspaceId:guid}/members")]
public class MembersController(
    AppDbContext db,
    ICurrentUserService currentUser,
    IMembershipService memberships) : ControllerBase
{
    // Seven days, matching GitHub. Bounds how long a leaked link stays useful.
    private const int InvitationLifetimeDays = 7;

    [HttpGet]
    public async Task<ActionResult<WorkspaceMembersResponse>> GetMembers(Guid workspaceId, CancellationToken ct)
    {
        return await Run(async () =>
        {
            await EnsureWorkspaceVisibleAsync(workspaceId, ct);

            var members = await db.Memberships
                .Where(m => m.WorkspaceId == workspaceId)
                .Select(m => new MemberResponse(m.UserId, m.User.DisplayName, m.User.Email, m.Role.ToString()))
                .ToListAsync(ct);

            // Withheld from everyone but owners -- see PendingInvitationResponse.
            // Filtered in the projection rather than after it so the secret is
            // never materialised for a caller who may not have it.
            var isOwner = currentUser.RoleIn(workspaceId) == MembershipRole.Owner;

            var pending = await db.Invitations
                .Where(i => i.WorkspaceId == workspaceId && i.AcceptedAt == null)
                .Select(i => new PendingInvitationResponse(
                    i.Id, i.Email, i.Role.ToString(), i.CreatedAt, isOwner ? i.Token : null, i.ExpiresAt))
                .ToListAsync(ct);

            return new WorkspaceMembersResponse(members, pending);
        });
    }

    // Hybrid invite: an address that already belongs to a user becomes a
    // membership straight away -- an owner adding someone who is already here
    // has all the identity there is to have. Anything else becomes a pending
    // invitation whose token the owner passes along; nothing grants membership
    // until that person opens the link and accepts.
    [HttpPost]
    public async Task<ActionResult<InviteMemberResponse>> InviteMember(
        Guid workspaceId, InviteMemberRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return ValidationProblem("An email address is required.");
        }

        if (!TryParseRole(request.Role, out var role))
        {
            return ValidationProblem("Role must be one of Owner, Editor, or Viewer.");
        }

        var email = EmailAddress.Normalize(request.Email);

        try
        {
            await EnsureOwnerAsync(workspaceId, ct);

            var invitee = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

            if (invitee is not null)
            {
                var existing = await db.Memberships
                    .FirstOrDefaultAsync(m => m.WorkspaceId == workspaceId && m.UserId == invitee.Id, ct);

                if (existing is not null)
                {
                    // Re-inviting someone who is already in the workspace is
                    // treated as a role change rather than an error.
                    if (existing.Role != role && await WouldRemoveLastOwnerAsync(workspaceId, existing.Role, role, ct))
                    {
                        return ValidationProblem("A workspace must keep at least one owner.");
                    }

                    existing.Role = role;
                }
                else
                {
                    db.Memberships.Add(new Membership
                    {
                        Id = Guid.NewGuid(),
                        WorkspaceId = workspaceId,
                        UserId = invitee.Id,
                        Role = role,
                        CreatedAt = DateTimeOffset.UtcNow
                    });
                }

                await db.SaveChangesAsync(ct);

                return new InviteMemberResponse(
                    true,
                    new MemberResponse(invitee.Id, invitee.DisplayName, invitee.Email, role.ToString()),
                    null);
            }

            // Unique on (workspace_id, email), so a repeat invite updates the
            // role on the pending row instead of stacking duplicates.
            var invitation = await db.Invitations
                .FirstOrDefaultAsync(i => i.WorkspaceId == workspaceId && i.Email == email, ct);

            if (invitation is null)
            {
                invitation = new Invitation
                {
                    Id = Guid.NewGuid(),
                    WorkspaceId = workspaceId,
                    Email = email,
                    Role = role,
                    InvitedByUserId = currentUser.UserId,
                    Token = InvitationsController.NewToken(),
                    CreatedAt = DateTimeOffset.UtcNow,
                    ExpiresAt = DateTimeOffset.UtcNow.AddDays(InvitationLifetimeDays)
                };
                db.Invitations.Add(invitation);
            }
            else
            {
                invitation.Role = role;
                invitation.InvitedByUserId = currentUser.UserId;
                invitation.AcceptedAt = null;
                invitation.AcceptedByUserId = null;
                // Re-inviting clears a decline and restarts the clock, but mints
                // a fresh secret too: the old link may have been shared
                // somewhere the owner no longer wants it to work.
                invitation.DeclinedAt = null;
                invitation.Token = InvitationsController.NewToken();
                invitation.ExpiresAt = DateTimeOffset.UtcNow.AddDays(InvitationLifetimeDays);
            }

            await db.SaveChangesAsync(ct);

            return new InviteMemberResponse(
                false,
                null,
                new PendingInvitationResponse(
                    invitation.Id, invitation.Email, invitation.Role.ToString(),
                    invitation.CreatedAt, invitation.Token, invitation.ExpiresAt));
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

    [HttpPatch("{userId:guid}")]
    public async Task<ActionResult<MemberResponse>> UpdateMemberRole(
        Guid workspaceId, Guid userId, UpdateMemberRoleRequest request, CancellationToken ct)
    {
        if (!TryParseRole(request.Role, out var role))
        {
            return ValidationProblem("Role must be one of Owner, Editor, or Viewer.");
        }

        try
        {
            await EnsureOwnerAsync(workspaceId, ct);

            var membership = await db.Memberships
                .Include(m => m.User)
                .FirstOrDefaultAsync(m => m.WorkspaceId == workspaceId && m.UserId == userId, ct);

            if (membership is null)
            {
                return NotFound();
            }

            if (membership.Role != role && await WouldRemoveLastOwnerAsync(workspaceId, membership.Role, role, ct))
            {
                return ValidationProblem("A workspace must keep at least one owner.");
            }

            membership.Role = role;
            await db.SaveChangesAsync(ct);

            return new MemberResponse(userId, membership.User.DisplayName, membership.User.Email, role.ToString());
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

    [HttpDelete("{userId:guid}")]
    public async Task<IActionResult> RemoveMember(Guid workspaceId, Guid userId, CancellationToken ct)
    {
        try
        {
            await EnsureOwnerAsync(workspaceId, ct);

            var membership = await db.Memberships
                .FirstOrDefaultAsync(m => m.WorkspaceId == workspaceId && m.UserId == userId, ct);

            if (membership is null)
            {
                return NotFound();
            }

            if (membership.Role == MembershipRole.Owner && await memberships.CountOwnersAsync(workspaceId, ct) <= 1)
            {
                return ValidationProblem("A workspace must keep at least one owner.");
            }

            db.Memberships.Remove(membership);
            await db.SaveChangesAsync(ct);

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

    [HttpDelete("invitations/{invitationId:guid}")]
    public async Task<IActionResult> RevokeInvitation(Guid workspaceId, Guid invitationId, CancellationToken ct)
    {
        try
        {
            await EnsureOwnerAsync(workspaceId, ct);

            var invitation = await db.Invitations
                .FirstOrDefaultAsync(i => i.Id == invitationId && i.WorkspaceId == workspaceId && i.AcceptedAt == null, ct);

            if (invitation is null)
            {
                return NotFound();
            }

            db.Invitations.Remove(invitation);
            await db.SaveChangesAsync(ct);

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

    private static bool TryParseRole(string? value, out MembershipRole role) =>
        Enum.TryParse(value, ignoreCase: true, out role) && Enum.IsDefined(role);

    // The workspace query filter already scopes this to the caller's
    // memberships, so a miss means "not found or not yours" -- the same
    // conflation the board endpoints use, and deliberately not a 403 (which
    // would confirm the workspace exists).
    private async Task EnsureWorkspaceVisibleAsync(Guid workspaceId, CancellationToken ct)
    {
        if (!await db.Workspaces.AnyAsync(w => w.Id == workspaceId, ct))
        {
            throw new BoardOperationNotFoundException("Workspace not found.");
        }
    }

    private async Task EnsureOwnerAsync(Guid workspaceId, CancellationToken ct)
    {
        await EnsureWorkspaceVisibleAsync(workspaceId, ct);

        var role = currentUser.RoleIn(workspaceId);
        if (role != MembershipRole.Owner)
        {
            throw new BoardOperationForbiddenException("Only workspace owners can manage members.");
        }
    }

    private async Task<bool> WouldRemoveLastOwnerAsync(
        Guid workspaceId, MembershipRole currentRole, MembershipRole newRole, CancellationToken ct) =>
        currentRole == MembershipRole.Owner
        && newRole != MembershipRole.Owner
        && await memberships.CountOwnersAsync(workspaceId, ct) <= 1;

    private async Task<ActionResult<T>> Run<T>(Func<Task<T>> operation)
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
