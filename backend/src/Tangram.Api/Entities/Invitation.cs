namespace Tangram.Api.Entities;

// A workspace membership offered to an email address that may not have a User
// row yet. Claimed on the invitee's first authenticated request (see
// CurrentUserLoader), which is what makes "invite someone who hasn't signed up"
// work without an out-of-band email/token flow.
public class Invitation
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }

    // Always stored normalized (lowercase, trimmed) so claim lookups are an
    // exact index hit rather than a case-insensitive scan.
    public required string Email { get; set; }

    public MembershipRole Role { get; set; }
    public Guid InvitedByUserId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    // Set together when claimed. A non-null AcceptedAt takes the row out of
    // the claim query permanently -- the resulting Membership is the source of
    // truth from that point on, and the row is kept as an audit trail.
    public DateTimeOffset? AcceptedAt { get; set; }
    public Guid? AcceptedByUserId { get; set; }

    public Workspace Workspace { get; set; } = null!;
}
