namespace Tangram.Api.Entities;

// A workspace membership offered to an email address that may not have a User
// row yet.
//
// The authority to join lives in Token, not in the address. It used to be the
// other way round: any authenticated user whose email matched a pending
// invitation was silently made a member on their next request. Since nothing in
// this stack verifies an email address -- Firebase treats a password sign-up as
// unverified -- knowing an invited address was enough to take the invitation
// meant for someone else. Holding a secret is a claim about capability; knowing
// an address is not.
public class Invitation
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }

    // Always stored normalized (lowercase, trimmed) so claim lookups are an
    // exact index hit rather than a case-insensitive scan.
    public required string Email { get; set; }

    public MembershipRole Role { get; set; }
    public Guid InvitedByUserId { get; set; }

    // The secret the invite link carries. Cryptographically random, unique, and
    // the only thing that grants membership. Nothing sends mail here -- the
    // owner pastes the link into Slack or WhatsApp themselves -- so the link is
    // the delivery mechanism and has to be what holds the authority.
    public required string Token { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    // Seven days, matching GitHub. A bound on how long a leaked link stays
    // useful, and it makes a forgotten invitation stop being a standing door.
    public DateTimeOffset ExpiresAt { get; set; }

    // Set when the invitee turns the invitation down. Distinct from deleting the
    // row: without it, declining would simply re-offer on the next visit.
    public DateTimeOffset? DeclinedAt { get; set; }

    // Set together when claimed. A non-null AcceptedAt takes the row out of
    // the claim query permanently -- the resulting Membership is the source of
    // truth from that point on, and the row is kept as an audit trail.
    public DateTimeOffset? AcceptedAt { get; set; }
    public Guid? AcceptedByUserId { get; set; }

    public Workspace Workspace { get; set; } = null!;
}
