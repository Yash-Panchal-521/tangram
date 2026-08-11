namespace Tangram.Api.Dtos;

public record MeResponse(Guid Id, string DisplayName, string? AvatarUrl);

public record CreateWorkspaceRequest(string Name);
public record WorkspaceResponse(Guid Id, string Name, DateTimeOffset CreatedAt);
public record WorkspaceBoardSummary(Guid Id, string Name, bool Archived, DateTimeOffset UpdatedAt);
public record RenameBoardRequest(string Name);
public record WorkspaceSummaryResponse(Guid Id, string Name, string Role, List<WorkspaceBoardSummary> Boards);

public record InviteMemberRequest(string Email, string Role);
public record UpdateMemberRoleRequest(string Role);
public record MemberResponse(Guid UserId, string DisplayName, string? Email, string Role);
// Token is null for anyone but an owner. It is the credential that grants
// membership, so a viewer who could read it could hand out access -- exactly the
// authority the role withholds. Reading *that* someone was invited is fine;
// reading the link is not.
public record PendingInvitationResponse(
    Guid Id, string Email, string Role, DateTimeOffset CreatedAt, string? Token, DateTimeOffset ExpiresAt);

// What the invite page and the sign-up banner show before anyone commits to
// anything: the workspace name, the role offered, who sent it, and the address
// it was sent to. Nothing about the board's contents.
//
// The email is here rather than in the link's query string on purpose. It is
// needed to prefill sign-up, but a URL parameter would put a real person's
// address into browser history, Referer headers and every access log the link
// passes through, and it would travel with each forward. Whoever holds the
// token can already take the membership, so learning the address costs nothing
// they didn't already have.
public record InvitationOfferResponse(
    string WorkspaceName,
    string Role,
    string InvitedByName,
    string Email,
    string Status,
    DateTimeOffset ExpiresAt);
public record WorkspaceMembersResponse(List<MemberResponse> Members, List<PendingInvitationResponse> PendingInvitations);

// Distinguishes the two outcomes of an invite: the address already belonged to
// a user (joined immediately) or an invitation is now waiting to be claimed.
public record InviteMemberResponse(bool Joined, MemberResponse? Member, PendingInvitationResponse? Invitation);

// Columns arrive with the board or not at all.
//
// SeedDefaultColumns is for a board created on someone's behalf: they never
// asked for it, so it should arrive usable. Columns carries an explicit list,
// which is what the welcome flow's template picker sends. Either way the columns
// are written inside the same transaction with no operations rows -- scaffolding
// is not work the user did, and recording it as such made it undoable into a
// dead end.
//
// A board created from the board list stays empty: its empty state names the
// next action, and someone who chose to make one may want a different shape of
// work.
public record CreateBoardRequest(
    string Name,
    bool SeedDefaultColumns = false,
    List<string>? Columns = null);
public record BoardResponse(Guid Id, Guid WorkspaceId, string Name, DateTimeOffset CreatedAt);

public record CreateColumnRequest(string Name);
public record RenameColumnRequest(string Name);
public record MoveColumnRequest(Guid? BeforeColumnId);
public record ColumnResponse(Guid Id, Guid BoardId, string Name, string Rank);
public record ColumnDeletedPayload(Guid Id);

public record CreateCardRequest(string Title, string? Description);

// One request shape for every field-level edit on a card. Splitting due date and
// assignee into their own endpoints would mean three operations -- and three
// inverses -- for what a user experiences as one edit in one panel.
//
// Every field is optional, and `null` is a real value: clearing a due date and
// leaving it alone have to be distinguishable, which is what the Clear* flags
// are for. JSON cannot express "absent" and "null" through a non-nullable
// record property.
public record UpdateCardRequest(
    string? Title,
    string? Description,
    DateTimeOffset? DueAt,
    Guid? AssigneeId,
    bool ClearDueAt = false,
    bool ClearAssignee = false,
    // A string rather than the enum, so an unknown level is a 400 the caller
    // can read instead of a silent deserialization to the first member.
    string? Priority = null,
    bool ClearPriority = false,
    // Set semantics: the complete list replaces whatever was there. Null means
    // "this edit says nothing about labels", so no Clear flag is needed -- an
    // empty list already expresses "remove them all" unambiguously.
    List<Guid>? LabelIds = null);

public record MoveCardRequest(Guid TargetColumnId, Guid? BeforeCardId);

public record LabelResponse(Guid Id, string Name, string Color);
public record CreateLabelRequest(string Name, string? Color);
public record UpdateLabelRequest(string? Name, string? Color);
public record LabelDeletedPayload(Guid Id);

// CreatedAt/UpdatedAt are on the entity and were simply never exposed. The detail
// view shows them, and they cost nothing to carry: this record is also the
// broadcast payload for card operations, so a resyncing client gets them too.
public record CardResponse(
    Guid Id,
    Guid ColumnId,
    string Title,
    string? Description,
    string Rank,
    DateTimeOffset? DueAt = null,
    Guid? AssigneeId = null,
    DateTimeOffset CreatedAt = default,
    DateTimeOffset UpdatedAt = default,
    // Null means nobody has set one, which is a state rather than a gap.
    string? Priority = null,
    // The whole set, every time. A card's labels are a field of the card in the
    // same way its assignee is, which is what lets them ride the existing card
    // operations instead of needing add/remove ops of their own.
    List<LabelResponse>? Labels = null);
public record CardDeletedPayload(Guid Id, Guid ColumnId);

public record ColumnWithCardsResponse(Guid Id, string Name, string Rank, List<CardResponse> Cards);
// WorkspaceId is included so the board UI can link to that workspace's member
// management without a second round trip to resolve which workspace it's in.
// Role is the caller's own role, so the client can render a read-only board for
// viewers instead of showing edit controls that every mutation would reject.
public record BoardDetailResponse(
    Guid Id, Guid WorkspaceId, string Name, string Role, long Seq, List<ColumnWithCardsResponse> Columns,
    // The board's whole label vocabulary, which the picker needs even for
    // labels no card currently carries.
    List<LabelResponse>? Labels = null);

public record OperationBroadcast(long Seq, string OpType, object Payload);
public record ResyncResult(bool NeedsSnapshot, List<OperationBroadcast> Operations);
public record CursorUpdate(Guid UserId, string DisplayName, double X, double Y);
