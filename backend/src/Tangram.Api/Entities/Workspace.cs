namespace Tangram.Api.Entities;

// Tenant boundary. Every workspace-scoped query is filtered to the
// caller's workspaces via the current-user accessor (see CurrentUserService).
public class Workspace
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public Guid CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public ICollection<Membership> Memberships { get; set; } = new List<Membership>();
    public ICollection<Board> Boards { get; set; } = new List<Board>();
    public ICollection<Invitation> Invitations { get; set; } = new List<Invitation>();
}
