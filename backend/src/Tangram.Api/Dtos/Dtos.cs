namespace Tangram.Api.Dtos;

public record MeResponse(Guid Id, string DisplayName, string? AvatarUrl);

public record CreateWorkspaceRequest(string Name);
public record WorkspaceResponse(Guid Id, string Name, DateTimeOffset CreatedAt);

public record CreateBoardRequest(string Name);
public record BoardResponse(Guid Id, Guid WorkspaceId, string Name, DateTimeOffset CreatedAt);

public record CreateColumnRequest(string Name);
public record ColumnResponse(Guid Id, Guid BoardId, string Name, string Rank);

public record CreateCardRequest(string Title, string? Description);
public record CardResponse(Guid Id, Guid ColumnId, string Title, string? Description, string Rank);

public record ColumnWithCardsResponse(Guid Id, string Name, string Rank, List<CardResponse> Cards);
public record BoardDetailResponse(Guid Id, string Name, List<ColumnWithCardsResponse> Columns);

public record OperationBroadcast(long Seq, string OpType, object Payload);
