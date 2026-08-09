const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5286";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  token: string | null,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    // ASP.NET returns ProblemDetails/ValidationProblemDetails on 400s, and the
    // message there is the only place a rule like "a workspace must keep at
    // least one owner" is explained -- surface it instead of a bare status.
    let detail: string | undefined;
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.title;
    } catch {
      // Empty or non-JSON body (403 and 404 from Forbid()/NotFound() have none).
    }

    throw new ApiError(
      res.status,
      detail ?? `${init?.method ?? "GET"} ${path} failed with ${res.status}`
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, token: string | null) => request<T>(path, token),
  post: <T>(path: string, token: string | null, body?: unknown) =>
    request<T>(path, token, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, token: string | null, body?: unknown) =>
    request<T>(path, token, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, token: string | null) => request<T>(path, token, { method: "DELETE" }),
};

export const API_BASE = API_BASE_URL;

export interface WorkspaceResponse {
  id: string;
  name: string;
  createdAt: string;
}

export interface BoardResponse {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
}

export interface ColumnResponse {
  id: string;
  boardId: string;
  name: string;
  rank: string;
}

export interface CardResponse {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  rank: string;
}

export interface ColumnWithCardsResponse {
  id: string;
  name: string;
  rank: string;
  cards: CardResponse[];
}

export interface BoardDetailResponse {
  id: string;
  workspaceId: string;
  seq: number;
  name: string;
  /** The *caller's* role in this board's workspace, not a property of the board. */
  role: MembershipRole;
  columns: ColumnWithCardsResponse[];
}

export interface MeResponse {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export type MembershipRole = "Owner" | "Editor" | "Viewer";

export interface WorkspaceBoardSummary {
  id: string;
  name: string;
}

export interface WorkspaceSummaryResponse {
  id: string;
  name: string;
  role: MembershipRole;
  boards: WorkspaceBoardSummary[];
}

export interface MemberResponse {
  userId: string;
  displayName: string;
  email: string | null;
  role: MembershipRole;
}

export interface PendingInvitationResponse {
  id: string;
  email: string;
  role: MembershipRole;
  createdAt: string;
}

export interface WorkspaceMembersResponse {
  members: MemberResponse[];
  pendingInvitations: PendingInvitationResponse[];
}

export interface InviteMemberResponse {
  joined: boolean;
  member: MemberResponse | null;
  invitation: PendingInvitationResponse | null;
}

export interface ActivityEntry {
  seq: number;
  opType: string;
  actorId: string;
  actorName: string;
  /** Composed server-side: a delete's payload holds only ids, so the client
   *  cannot name what was deleted. */
  summary: string;
  createdAt: string;
  undone: boolean;
  /** Your own, not yet reversed, and reversible. */
  canUndo: boolean;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
  /** The seq the undo button would act on, or null when there is nothing. */
  undoableSeq: number | null;
}
