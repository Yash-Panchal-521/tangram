using Microsoft.EntityFrameworkCore;
using Tangram.Api.Data;
using Tangram.Api.Entities;

namespace Tangram.Api.Services;

// One definition of "what role does this user hold in this workspace", shared
// by the board mutation path (BoardOperationService) and the workspace member
// endpoints (MembersController) so the two can't drift apart on RBAC.
public interface IMembershipService
{
    // Returns null when the user holds no membership in that workspace.
    Task<MembershipRole?> GetRoleAsync(Guid workspaceId, Guid userId, CancellationToken ct);

    // Owners are the only role that can change who else is in the workspace.
    Task<int> CountOwnersAsync(Guid workspaceId, CancellationToken ct);
}

public class MembershipService(AppDbContext db) : IMembershipService
{
    // Memberships carry no global query filter -- they're the table the filters
    // are derived from -- so these are plain queries.
    public Task<MembershipRole?> GetRoleAsync(Guid workspaceId, Guid userId, CancellationToken ct) =>
        db.Memberships
            .Where(m => m.WorkspaceId == workspaceId && m.UserId == userId)
            .Select(m => (MembershipRole?)m.Role)
            .FirstOrDefaultAsync(ct);

    public Task<int> CountOwnersAsync(Guid workspaceId, CancellationToken ct) =>
        db.Memberships.CountAsync(m => m.WorkspaceId == workspaceId && m.Role == MembershipRole.Owner, ct);
}
