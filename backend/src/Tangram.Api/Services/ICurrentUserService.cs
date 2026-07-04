namespace Tangram.Api.Services;

// Populated once per request by CurrentUserMiddleware, after JWT validation
// and the user-upsert. The EF Core global query filters read WorkspaceIds
// from this scoped instance to enforce tenant isolation on every query.
public interface ICurrentUserService
{
    Guid UserId { get; }
    bool IsLoaded { get; }
    IReadOnlyCollection<Guid> WorkspaceIds { get; }

    void Load(Guid userId, IEnumerable<Guid> workspaceIds);
}

public class CurrentUserService : ICurrentUserService
{
    private HashSet<Guid> _workspaceIds = new();

    public Guid UserId { get; private set; }
    public bool IsLoaded { get; private set; }
    public IReadOnlyCollection<Guid> WorkspaceIds => _workspaceIds;

    public void Load(Guid userId, IEnumerable<Guid> workspaceIds)
    {
        UserId = userId;
        _workspaceIds = new HashSet<Guid>(workspaceIds);
        IsLoaded = true;
    }
}
