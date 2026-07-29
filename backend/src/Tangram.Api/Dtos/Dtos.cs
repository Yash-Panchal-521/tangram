namespace Tangram.Api.Dtos;

public record MeResponse(Guid Id, string DisplayName, string? AvatarUrl);

public record CreateWorkspaceRequest(string Name);
public record WorkspaceResponse(Guid Id, string Name, DateTimeOffset CreatedAt);
public record WorkspaceBoardSummary(Guid Id, string Name);
public record WorkspaceSummaryResponse(Guid Id, string Name, string Role, List<WorkspaceBoardSummary> Boards);

public record InviteMemberRequest(string Email, string Role);
public record UpdateMemberRoleRequest(string Role);
public record MemberResponse(Guid UserId, string DisplayName, string? Email, string Role);
public record PendingInvitationResponse(Guid Id, string Email, string Role, DateTimeOffset CreatedAt);
public record WorkspaceMembersResponse(List<MemberResponse> Members, List<PendingInvitationResponse> PendingInvitations);

// Distinguishes the two outcomes of an invite: the address already belonged to
// a user (joined immediately) or an invitation is now waiting to be claimed.
public record InviteMemberResponse(bool Joined, MemberResponse? Member, PendingInvitationResponse? Invitation);

public record CreateBoardRequest(string Name);
public record BoardResponse(Guid Id, Guid WorkspaceId, string Name, DateTimeOffset CreatedAt);

public record CreateColumnRequest(string Name);
public record RenameColumnRequest(string Name);
public record MoveColumnRequest(Guid? BeforeColumnId);
public record ColumnResponse(Guid Id, Guid BoardId, string Name, string Rank);
public record ColumnDeletedPayload(Guid Id);

public record CreateCardRequest(string Title, string? Description);
public record RenameCardRequest(string Title, string? Description);
public record MoveCardRequest(Guid TargetColumnId, Guid? BeforeCardId);
public record CardResponse(Guid Id, Guid ColumnId, string Title, string? Description, string Rank);
public record CardDeletedPayload(Guid Id, Guid ColumnId);

public record ColumnWithCardsResponse(Guid Id, string Name, string Rank, List<CardResponse> Cards);
// WorkspaceId is included so the board UI can link to that workspace's member
// management without a second round trip to resolve which workspace it's in.
public record BoardDetailResponse(Guid Id, Guid WorkspaceId, string Name, long Seq, List<ColumnWithCardsResponse> Columns);

public record OperationBroadcast(long Seq, string OpType, object Payload);
public record ResyncResult(bool NeedsSnapshot, List<OperationBroadcast> Operations);
public record CursorUpdate(Guid UserId, string DisplayName, double X, double Y);
