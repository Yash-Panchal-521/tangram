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
  /** Work-in-progress limits. Null means no limit; 0 is a limit of zero. */
  minCards: number | null;
  maxCards: number | null;
}

/**
 * A new card, complete.
 *
 * The optional fields ride the create request rather than a follow-up PATCH:
 * two calls would be two operations and two broadcasts, and everyone else would
 * watch the card appear bare and then acquire its assignee and labels a moment
 * later. No clear flags, unlike `UpdateCardRequest` — nothing exists yet to
 * clear, so absent and null mean the same thing.
 */
export interface CreateCardRequest {
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  priority?: CardPriority | null;
  dueAt?: string | null;
  labelIds?: string[];
}

export interface SetColumnLimitsRequest {
  minCards?: number | null;
  maxCards?: number | null;
  /** Set semantics: absent leaves a limit alone, these remove it. */
  clearMinCards?: boolean;
  clearMaxCards?: boolean;
}

export interface CardResponse {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  rank: string;
  /** UTC midnight on the due day. A due date is a day, not a moment. */
  dueAt: string | null;
  /** May name someone who has since left the workspace; treat unresolved as unassigned. */
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Null means nobody has set one — a state, not a gap. See CardPriority. */
  priority: CardPriority | null;
  /** The whole set. Labels are a field of the card, like its assignee. */
  labels: LabelResponse[];
  /** A count, not the thread — comments are unbounded and fetched on demand. */
  commentCount: number;
}

export interface CommentResponse {
  id: string;
  cardId: string;
  authorId: string;
  /** Resolved server-side, so a former member's comment still says who wrote it. */
  authorName: string;
  body: string;
  createdAt: string;
  /** Null until edited. Shown, because a reply may predate a rewrite. */
  editedAt: string | null;
}

export interface LabelResponse {
  id: string;
  name: string;
  /** A palette name, never a hex — see lib/labelColors.ts for the mapping. */
  color: LabelColor;
}

export type LabelColor = "grey" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";

/** Jira's five levels. Ordered most to least urgent. */
export type CardPriority = "Highest" | "High" | "Medium" | "Low" | "Lowest";

/**
 * Every field-level edit to a card, in one request.
 *
 * `clearDueAt` / `clearAssignee` exist because JSON cannot distinguish "absent"
 * from "null" — without them, an edit that only changed the title would wipe
 * whatever it failed to mention.
 */
export interface UpdateCardRequest {
  title?: string | null;
  description?: string | null;
  dueAt?: string | null;
  assigneeId?: string | null;
  clearDueAt?: boolean;
  clearAssignee?: boolean;
  priority?: CardPriority | null;
  clearPriority?: boolean;
  /** Set semantics: this list replaces the card's labels. Omit to leave alone. */
  labelIds?: string[];
}

export interface ColumnWithCardsResponse {
  id: string;
  name: string;
  rank: string;
  cards: CardResponse[];
  minCards: number | null;
  maxCards: number | null;
}

export interface BoardDetailResponse {
  id: string;
  workspaceId: string;
  seq: number;
  name: string;
  /** The *caller's* role in this board's workspace, not a property of the board. */
  role: MembershipRole;
  columns: ColumnWithCardsResponse[];
  /** The board's whole vocabulary, including labels no card currently carries. */
  labels: LabelResponse[];
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
  /** Archived boards are still returned, flagged — a board that vanished with
   *  no trace would read as data loss and offer no way back. */
  archived: boolean;
  updatedAt: string;
  /** What shape the board is in, so the home row can say so without opening it.
   *  Correlated subqueries on the existing projection, not extra round trips. */
  columnCount: number;
  cardCount: number;
  /** Columns past their maximum. Only a maximum can be exceeded, so a board
   *  with no limits anywhere reports 0 rather than nothing. */
  overLimitColumns: number;
  /** In board order, for the distribution bar. Counts, not percentages — the
   *  width is the client's decision and it already knows the total. */
  columns: BoardColumnLoad[];
  /** Distinct assignees holding a card here. Membership is workspace-wide, so
   *  this says where attention is rather than who is permitted to look. */
  activePeople: string[];
}

export interface BoardColumnLoad {
  name: string;
  cardCount: number;
  overLimit: boolean;
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
  /** When this membership began — not when the account was created. The same
   *  person can be in two workspaces and joined each on a different day. */
  joinedAt: string;
}

export interface PendingInvitationResponse {
  id: string;
  email: string;
  role: MembershipRole;
  createdAt: string;
  /** The credential — null for anyone but an owner, since holding it grants membership. */
  token: string | null;
  expiresAt: string;
}

/** What `/invite/[token]` shows before anyone signs in — see InvitationsController. */
export interface InvitationOfferResponse {
  workspaceName: string;
  role: MembershipRole;
  invitedByName: string;
  /** Prefills sign-up. Carried in the response, never in the link — see the DTO. */
  email: string;
  status: "pending" | "accepted" | "declined" | "expired";
  expiresAt: string;
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

