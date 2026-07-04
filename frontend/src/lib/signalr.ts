import { HubConnection, HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { API_BASE } from "@/lib/api";

export function createBoardHubConnection(getToken: () => Promise<string | null>): HubConnection {
  return new HubConnectionBuilder()
    .withUrl(`${API_BASE}/hubs/board`, {
      accessTokenFactory: async () => (await getToken()) ?? "",
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build();
}

export interface OperationBroadcast {
  seq: number;
  opType: string;
  payload: unknown;
}

export interface PresenceUser {
  userId: string;
  displayName: string;
}

export interface CursorUpdate {
  userId: string;
  displayName: string;
  x: number;
  y: number;
}

export interface ResyncResult {
  needsSnapshot: boolean;
  operations: OperationBroadcast[];
}
