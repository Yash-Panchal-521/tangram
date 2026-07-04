using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Entities;

namespace Tangram.Api.Services;

// Resolves the Firebase-authenticated principal to an internal User row
// (upserting on first sight) and populates ICurrentUserService with the
// user's accessible workspace ids. Called on every authenticated REST
// request AND on every inbound hub invocation — RBAC/tenant scope is
// re-derived per call, never cached across a connection.
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

        var user = await db.Users.IgnoreQueryFilters().SingleOrDefaultAsync(u => u.FirebaseUid == firebaseUid, ct);

        if (user is null)
        {
            var displayName = principal.FindFirstValue("name")
                ?? principal.FindFirstValue(ClaimTypes.Email)?.Split('@')[0]
                ?? "New user";

            user = new User
            {
                Id = Guid.NewGuid(),
                FirebaseUid = firebaseUid,
                DisplayName = displayName,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            db.Users.Add(user);
            await db.SaveChangesAsync(ct);
        }

        var workspaceIds = await db.Memberships
            .IgnoreQueryFilters()
            .Where(m => m.UserId == user.Id)
            .Select(m => m.WorkspaceId)
            .ToListAsync(ct);

        currentUserService.Load(user.Id, workspaceIds);

        return user;
    }
}
