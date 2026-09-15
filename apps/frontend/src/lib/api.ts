/**
 * Тонкий fetch-клиент к backend REST API (см. apps/backend, docs/architecture.md §45).
 * Ошибки backend (ValidationPipe/ForbiddenException/...) пробрасываются как
 * ApiError с сохранением статуса и тела ответа для UI (React Hook Form / antd).
 */
export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(typeof body?.message === "string" ? body.message : `HTTP ${status}`);
  }
}

export async function apiFetch<T>(path: string, headers: Record<string, string>, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...headers, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* тело может быть пустым */
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T,>(path: string, headers: Record<string, string>) => apiFetch<T>(path, headers),
  post: <T,>(path: string, headers: Record<string, string>, body?: unknown) =>
    apiFetch<T>(path, headers, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T,>(path: string, headers: Record<string, string>, body?: unknown) =>
    apiFetch<T>(path, headers, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string, headers: Record<string, string>) => apiFetch<T>(path, headers, { method: "DELETE" }),
};
