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
public record PendingInvitationResponse(Guid Id, string Email, string Role, DateTimeOffset CreatedAt);
public record WorkspaceMembersResponse(List<MemberResponse> Members, List<PendingInvitationResponse> PendingInvitations);

// Distinguishes the two outcomes of an invite: the address already belonged to
// a user (joined immediately) or an invitation is now waiting to be claimed.
public record InviteMemberResponse(bool Joined, MemberResponse? Member, PendingInvitationResponse? Invitation);

// SeedDefaultColumns is for the board the bootstrap creates on someone's behalf:
// they never asked for it, so it should arrive usable. A board created
// explicitly stays empty, because its empty state names the next action and the
// person choosing to make one may want a different shape of work.
public record CreateBoardRequest(string Name, bool SeedDefaultColumns = false);
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
    bool ClearAssignee = false);

public record MoveCardRequest(Guid TargetColumnId, Guid? BeforeCardId);
public record CardResponse(
    Guid Id,
    Guid ColumnId,
    string Title,
    string? Description,
    string Rank,
    DateTimeOffset? DueAt = null,
    Guid? AssigneeId = null);
public record CardDeletedPayload(Guid Id, Guid ColumnId);

public record ColumnWithCardsResponse(Guid Id, string Name, string Rank, List<CardResponse> Cards);
// WorkspaceId is included so the board UI can link to that workspace's member
// management without a second round trip to resolve which workspace it's in.
// Role is the caller's own role, so the client can render a read-only board for
// viewers instead of showing edit controls that every mutation would reject.
public record BoardDetailResponse(
    Guid Id, Guid WorkspaceId, string Name, string Role, long Seq, List<ColumnWithCardsResponse> Columns);

// The full prior state of a deleted column, including the cards the database
// cascade removed with it. Without the cards, undoing a column deletion would
// silently restore an empty column and lose the work it contained -- which is
// precisely the deletion people most want back.
public record ColumnSnapshot(Guid Id, Guid BoardId, string Name, string Rank, List<CardResponse> Cards);

// `Summary` is composed server-side because the client cannot: a delete's
// payload carries only ids, and the name it needs lives in the inverse.
public record ActivityEntry(
    long Seq,
    string OpType,
    Guid ActorId,
    string ActorName,
    string Summary,
    DateTimeOffset CreatedAt,
    bool Undone,
    bool CanUndo);

public record ActivityResponse(List<ActivityEntry> Entries, long? UndoableSeq);

public record OperationBroadcast(long Seq, string OpType, object Payload);
public record ResyncResult(bool NeedsSnapshot, List<OperationBroadcast> Operations);
public record CursorUpdate(Guid UserId, string DisplayName, double X, double Y);
