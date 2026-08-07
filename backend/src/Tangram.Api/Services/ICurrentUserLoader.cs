using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Entities;

namespace Tangram.Api.Services;

// Resolves the Firebase-authenticated principal to an internal User row
// (upserting on first sight), claims any invitations waiting on their email,
// and populates ICurrentUserService with the user's accessible workspace ids.
// Called on every authenticated REST request AND on every inbound hub
// invocation — RBAC/tenant scope is re-derived per call, never cached across
// a connection.
public interface ICurrentUserLoader
{
    Task<User> LoadAsync(ClaimsPrincipal principal, CancellationToken ct = default);
}

public class CurrentUserLoader(AppDbContext db, ICurrentUserService currentUserService) : ICurrentUserLoader
{
    public async Task<User> LoadAsync(ClaimsPrincipal principal, CancellationToken ct = default)
    {
        var firebaseUid = principal.FindFirstValue("user_id")
            ?? principal.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? principal.FindFirstValue("sub")
            ?? throw new InvalidOperationException("Token is missing a subject/user_id claim.");

        // JwtBearer's default inbound map rewrites Firebase's "email" claim to
        // ClaimTypes.Email; the raw name is kept as a fallback in case mapping
        // is ever turned off.
        var email = EmailAddress.NormalizeOrNull(
            principal.FindFirstValue(ClaimTypes.Email) ?? principal.FindFirstValue("email"));

        // Both spellings, for the same reason as email: JwtBearer's default
        // inbound map may rewrite "name" to ClaimTypes.Name, in which case
        // looking only for the raw name silently finds nothing and every user
        // ends up named after their email's local part.
        var claimedName = Trimmed(principal.FindFirstValue("name"))
            ?? Trimmed(principal.FindFirstValue(ClaimTypes.Name));

        var user = await db.Users.IgnoreQueryFilters().SingleOrDefaultAsync(u => u.FirebaseUid == firebaseUid, ct);

        if (user is null)
        {
            user = new User
            {
                Id = Guid.NewGuid(),
                FirebaseUid = firebaseUid,
                Email = email,
                // The email local part is a last resort, not a preference --
                // see the refresh below, which replaces it as soon as a token
                // carrying a real name arrives.
                DisplayName = claimedName ?? email?.Split('@')[0] ?? "New user",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            db.Users.Add(user);
            await db.SaveChangesAsync(ct);
        }
        else
        {
            var changed = false;

            // Backfills rows created before invitations existed (they have no
            // email and so could never be invited) and tracks address changes
            // made in Firebase.
            if (email is not null && user.Email != email)
            {
                user.Email = email;
                changed = true;
            }

            // Firebase is the only place a display name can be set, so its
            // token wins. This matters most right after sign-up: the profile
            // update and the first API call race, so the row is often created
            // from the email fallback and only a later token carries the real
            // name. Without this the wrong name is permanent.
            //
            // Guarded on the claim actually being present -- a token without a
            // name must never downgrade a good stored name back to the
            // email-local-part fallback.
            if (claimedName is not null && user.DisplayName != claimedName)
            {
                user.DisplayName = claimedName;
                changed = true;
            }

            if (changed)
            {
                user.UpdatedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
            }
        }

        // Must run before workspace ids are read below -- claiming after that
        // point would leave a freshly joined workspace invisible until the
        // user's next request.
        if (user.Email is not null)
        {
            await ClaimPendingInvitationsAsync(user, ct);
        }

        var workspaceIds = await db.Memberships
            .IgnoreQueryFilters()
            .Where(m => m.UserId == user.Id)
            .Select(m => m.WorkspaceId)
            .ToListAsync(ct);

        currentUserService.Load(user.Id, workspaceIds);

        return user;
    }

    private static string? Trimmed(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // Turns invitations addressed to this user's email into real memberships.
    // Runs on every authenticated call, so the common "nothing pending" case
    // must stay a single indexed lookup (see the (email, accepted_at) index).
    private async Task ClaimPendingInvitationsAsync(User user, CancellationToken ct)
    {
        var pending = await db.Invitations
            .IgnoreQueryFilters() // The invitee has no membership yet, so the tenant filter would hide their own invitation.
            .Where(i => i.Email == user.Email && i.AcceptedAt == null)
            .ToListAsync(ct);

        if (pending.Count == 0)
        {
            return;
        }

        var alreadyMemberOf = await db.Memberships
            .IgnoreQueryFilters()
            .Where(m => m.UserId == user.Id)
            .Select(m => m.WorkspaceId)
            .ToListAsync(ct);

        var now = DateTimeOffset.UtcNow;
        foreach (var invitation in pending)
        {
            if (!alreadyMemberOf.Contains(invitation.WorkspaceId))
            {
                db.Memberships.Add(new Membership
                {
                    Id = Guid.NewGuid(),
                    WorkspaceId = invitation.WorkspaceId,
                    UserId = user.Id,
                    Role = invitation.Role,
                    CreatedAt = now
                });
            }

            invitation.AcceptedAt = now;
            invitation.AcceptedByUserId = user.Id;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Two concurrent requests from the same user can race to claim the
            // same invitation; the unique (workspace_id, user_id) index on
            // memberships is what makes that safe to lose. The winner already
            // created the membership, so drop our tracked changes and carry on
            // with whatever is actually in the database.
            foreach (var entry in db.ChangeTracker.Entries().ToList())
            {
                await entry.ReloadAsync(ct);
            }
        }
    }
}
