export interface JWTPayload {
  userId: number;
  username: string;
  role: string;
  ownerId?: number;
}

export interface ApiResponse<T> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  timestamp: number;
}

export interface KeyInfo {
  id: number;
  key: string;
  hwid: string | null;
  status: string;
  subscribe: bigint;
  subscribeend: bigint | null;
  cheat: number;
  firstip: string | null;
  lastip: string | null;
  creator: string;
  banreason: string | null;
}

export interface CheatInfo {
  id: number;
  name: string;
  status: string;
  filename: string;
  process: string;
  external: boolean | null;
  injection: string;
  creator: string;
}

export interface AuthRequest {
  key: string;
  hwid: string;
}

export interface FileDownloadRequest {
  key: string;
  hwid: string;
}

export interface LogRequest {
  key: string;
  hwid: string;
  message: string;
}
