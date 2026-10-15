const BASE = '/api/v1';

/** Событие окна: сервер ответил 401 - сессия истекла или ID убрали из настроек, нужен повторный вход. */
export const UNAUTHORIZED_EVENT = 'flagman:unauthorized';

/** Ошибка API с текстом из ProblemDetails и ошибками по полям. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors: Record<string, string[]> = {},
    public readonly body: unknown = null,
  ) {
    super(message);
  }

  /** Первая понятная пользователю причина. */
  get detail(): string {
    const first = Object.values(this.fieldErrors)[0]?.[0];
    return first ?? this.message;
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Нет связи с сервером. Проверьте, что бэкенд запущен.', 0);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    // 403 на сводке значит, что в этом браузере вошли с другой ролью (например, в кабинете поставщика).
    if ((res.status === 401 && !path.startsWith('/auth/')) || (res.status === 403 && path === '/summary'))
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const problem = (data ?? {}) as { title?: string; errors?: Record<string, string[]> };
    throw new ApiError(problem.title ?? `Ошибка ${res.status}`, res.status, problem.errors ?? {}, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
