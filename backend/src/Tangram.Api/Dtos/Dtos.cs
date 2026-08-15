namespace Tangram.Api.Dtos;

public record MeResponse(Guid Id, string DisplayName, string? AvatarUrl);

public record CreateWorkspaceRequest(string Name);
public record WorkspaceResponse(Guid Id, string Name, DateTimeOffset CreatedAt);
/// <summary>
/// A board as the workspace home lists it.
///
/// The three counts exist so the row can say what shape the board is in without
/// opening it — "4 columns · 22 cards · Review is over its limit" is the line
/// that makes the list worth reading rather than a set of names. They are
/// correlated subqueries inside the existing projection, not extra round trips
/// (P3.1): the request already visits this board, so the counts ride along.
/// </summary>
public record WorkspaceBoardSummary(
    Guid Id,
    string Name,
    bool Archived,
    DateTimeOffset UpdatedAt,
    int ColumnCount,
    int CardCount,
    int OverLimitColumns,
    List<BoardColumnLoad> Columns,
    /// <summary>
    /// Who is carrying work on this board — the distinct assignees of its cards,
    /// not the workspace roster. Membership is workspace-wide here, so "the
    /// people on this board" is only answerable as "the people holding a card on
    /// it", and that is the more useful answer anyway: it says where attention
    /// actually is rather than who is permitted to look.
    /// </summary>
    List<string> ActivePeople);

/// <summary>
/// One column's share of a board, for the home row's distribution bar.
///
/// Sent as counts rather than percentages: a width is a rendering decision, and
/// the client already knows the total. Ordered by rank so the bar reads left to
/// right in the same order as the board itself — a distribution drawn in an
/// arbitrary order would say something untrue about where work is piling up.
/// </summary>
public record BoardColumnLoad(string Name, int CardCount, bool OverLimit);
public record RenameBoardRequest(string Name);
public record WorkspaceSummaryResponse(Guid Id, string Name, string Role, List<WorkspaceBoardSummary> Boards);

public record InviteMemberRequest(string Email, string Role);
public record UpdateMemberRoleRequest(string Role);
/// <summary>
/// A member of a workspace.
///
/// <paramref name="JoinedAt"/> is the membership's own creation time, not the
/// user's: the same person can be in two workspaces and joined each on a
/// different day, and the members table is asking about this one.
/// </summary>
public record MemberResponse(
    Guid UserId,
    string DisplayName,
    string? Email,
    string Role,
    DateTimeOffset JoinedAt);
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

/// <summary>
/// Several columns at once, in the order given.
/// </summary>
/// <remarks>
/// One call rather than one per column because seeding a board is a single
/// intent: four separate requests can fail on the third, and the board is then
/// half a workflow with nothing to say about it. This lands in one transaction
/// — all the columns or none — while still emitting an ordinary
/// <c>column.create</c> per column, so no client needs teaching a new
/// operation type to see them arrive.
/// </remarks>
public record CreateColumnsRequest(List<string> Names);

/// <summary>
/// A column's card limits. Absent means leave alone; explicit null clears.
/// </summary>
/// <remarks>
/// Set semantics need the flags, exactly as <see cref="UpdateCardRequest"/>
/// does for due date and assignee: JSON cannot distinguish a field that was
/// omitted from one sent as null, so "leave the maximum alone" and "remove the
/// maximum" would be the same request.
/// </remarks>
public record SetColumnLimitsRequest(
    int? MinCards,
    int? MaxCards,
    bool ClearMinCards = false,
    bool ClearMaxCards = false);
public record MoveColumnRequest(Guid? BeforeColumnId);
public record ColumnResponse(
    Guid Id,
    Guid BoardId,
    string Name,
    string Rank,
    int? MinCards = null,
    int? MaxCards = null);
public record ColumnDeletedPayload(Guid Id);

/// <summary>
/// A new card, complete.
/// </summary>
/// <remarks>
/// The optional fields are here rather than left to a follow-up PATCH so a
/// card is created once: two calls would mean two operations, two sequence
/// numbers and two broadcasts, and everyone else would watch the card appear
/// bare and then visibly acquire its assignee and labels a moment later.
///
/// No clear flags, unlike <see cref="UpdateCardRequest"/>. Nothing exists yet
/// to clear, so absent and null mean the same thing here — "not set".
/// </remarks>
public record CreateCardRequest(
    string Title,
    string? Description,
    Guid? AssigneeId = null,
    string? Priority = null,
    DateTimeOffset? DueAt = null,
    List<Guid>? LabelIds = null);

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

// AuthorName is resolved server-side: the client has the workspace roster, but
// not for somebody who has since left, and a comment must still say who wrote it.
public record CommentResponse(
    Guid Id,
    Guid CardId,
    Guid AuthorId,
    string AuthorName,
    string Body,
    DateTimeOffset CreatedAt,
    DateTimeOffset? EditedAt);

public record CreateCommentRequest(string Body);
public record UpdateCommentRequest(string Body);
public record CommentDeletedPayload(Guid Id, Guid CardId);

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
    List<LabelResponse>? Labels = null,
    // A count, not the comments. A card's labels are bounded and travel with
    // it; its comments are not, and loading every one on every card just to
    // render the board would be paying for the whole thread to show a number.
    int CommentCount = 0);
public record CardDeletedPayload(Guid Id, Guid ColumnId);

public record ColumnWithCardsResponse(
    Guid Id,
    string Name,
    string Rank,
    List<CardResponse> Cards,
    int? MinCards = null,
    int? MaxCards = null);
// WorkspaceId is included so the board UI can link to that workspace's member
// management without a second round trip to resolve which workspace it's in.
// Role is the caller's own role, so the client can render a read-only board for
// viewers instead of showing edit controls that every mutation would reject.
public record BoardDetailResponse(
    Guid Id, Guid WorkspaceId, string Name, string Role, long Seq, List<ColumnWithCardsResponse> Columns,
    // The board's whole label vocabulary, which the picker needs even for
    // labels no card currently carries.
    List<LabelResponse>? Labels = null,
    // A count, not the comments. A card's labels are bounded and travel with
    // it; its comments are not, and loading every one on every card just to
    // render the board would be paying for the whole thread to show a number.
    int CommentCount = 0);

public record OperationBroadcast(long Seq, string OpType, object Payload);
public record ResyncResult(bool NeedsSnapshot, List<OperationBroadcast> Operations);
public record CursorUpdate(Guid UserId, string DisplayName, double X, double Y);
