namespace Tangram.Api.Entities;

// RBAC source of truth: one row per (workspace, user), carrying the role.
public class Membership
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid UserId { get; set; }
    public MembershipRole Role { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public Workspace Workspace { get; set; } = null!;
    public User User { get; set; } = null!;
}
