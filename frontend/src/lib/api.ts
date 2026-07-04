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
    throw new ApiError(res.status, `${init?.method ?? "GET"} ${path} failed with ${res.status}`);
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
  name: string;
  columns: ColumnWithCardsResponse[];
}

export interface MeResponse {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}
