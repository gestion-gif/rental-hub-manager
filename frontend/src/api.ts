import { storage } from "@/src/utils/storage";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;
export const TOKEN_KEY = "session_token";

let memToken: string | null = null;

export function setToken(t: string | null) {
  memToken = t;
}

export async function getToken(): Promise<string | null> {
  if (memToken) return memToken;
  const stored = await storage.secureGet<string>(TOKEN_KEY, "");
  memToken = stored || null;
  return memToken;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(path: string, opts: RequestInit = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    memToken = null;
    await storage.secureRemove(TOKEN_KEY);
    throw new ApiError(401, "Unauthorized");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.detail || "Request failed");
  }
  return data;
}

export const api = {
  get: (p: string) => request(p),
  post: (p: string, body?: any) =>
    request(p, { method: "POST", body: JSON.stringify(body || {}) }),
  put: (p: string, body?: any) =>
    request(p, { method: "PUT", body: JSON.stringify(body || {}) }),
  patch: (p: string, body?: any) =>
    request(p, { method: "PATCH", body: JSON.stringify(body || {}) }),
  del: (p: string) => request(p, { method: "DELETE" }),
};
