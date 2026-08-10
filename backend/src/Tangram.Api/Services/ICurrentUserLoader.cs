using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Entities;

namespace Tangram.Api.Services;

// Resolves the Firebase-authenticated principal to an internal User row
// (upserting on first sight) and populates ICurrentUserService with the user's
// accessible workspace ids.
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

        // Invitations are no longer claimed here.
        //
        // This used to turn any pending invitation whose email matched the
        // caller into a membership, on every request. Nothing in this stack
        // verifies an email address -- Firebase treats a password sign-up as
        // unverified -- so knowing an invited address was enough to take an
        // invitation meant for someone else, and the person invited was made a
        // member of a workspace without ever being asked. Joining now requires
        // the secret in the invite link and an explicit accept; see
        // InvitationsController.
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

}
