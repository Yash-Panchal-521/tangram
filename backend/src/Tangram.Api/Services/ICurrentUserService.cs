using Tangram.Api.Entities;

namespace Tangram.Api.Services;

// Populated once per request by CurrentUserMiddleware, after JWT validation
// and the user-upsert. The EF Core global query filters read WorkspaceIds
// from this scoped instance to enforce tenant isolation on every query.
public interface ICurrentUserService
{
    Guid UserId { get; }
    bool IsLoaded { get; }
    IReadOnlyCollection<Guid> WorkspaceIds { get; }

    /// <summary>
    /// The caller's role in a workspace, or null if they are not a member.
    /// </summary>
    /// <remarks>
    /// Answered from memory, not from the database. The memberships were already
    /// read to build <see cref="WorkspaceIds"/>, and the role is one more column
    /// on rows that were being fetched anyway — so asking the database again is
    /// a round trip spent re-reading something this request already holds.
    ///
    /// Every mutation used to do exactly that: <c>EnsureCanMutateAsync</c> called
    /// <c>IMembershipService.GetRoleAsync</c>, two queries after the loader had
    /// fetched and discarded the same rows.
    ///
    /// This is still per-request scope, not a cache. The instance dies with the
    /// request, so tenant scope and role are re-derived on the next one — which
    /// is the invariant, and the reason a removed member cannot keep acting on a
    /// long-lived connection.
    /// </remarks>
    MembershipRole? RoleIn(Guid workspaceId);

    void Load(Guid userId, IEnumerable<(Guid WorkspaceId, MembershipRole Role)> memberships);
}

public class CurrentUserService : ICurrentUserService
{
    private Dictionary<Guid, MembershipRole> _memberships = [];

    public Guid UserId { get; private set; }
    public bool IsLoaded { get; private set; }
    public IReadOnlyCollection<Guid> WorkspaceIds => _memberships.Keys;

    public MembershipRole? RoleIn(Guid workspaceId) =>
        _memberships.TryGetValue(workspaceId, out var role) ? role : null;

    public void Load(Guid userId, IEnumerable<(Guid WorkspaceId, MembershipRole Role)> memberships)
    {
        UserId = userId;
        // Last one wins rather than throwing on a duplicate: a (workspace, user)
        // pair is unique in the schema, so a duplicate here would mean the index
        // is gone — and failing every request with a dictionary exception is a
        // worse way to find that out than the role simply being right.
        _memberships = memberships
            .GroupBy(m => m.WorkspaceId)
            .ToDictionary(g => g.Key, g => g.Last().Role);
        IsLoaded = true;
    }
}
