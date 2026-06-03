import type { Catalog, Session, SessionSummary, User } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000/api';

export class ApiError extends Error {
  status: number;
  details?: { field: string; message: string }[];
  constructor(status: number, message: string, details?: ApiError['details']) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions extends RequestInit {
  /** Internal flag so a single retry-after-refresh doesn't loop forever. */
  _retry?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  // Transparently refresh an expired access token once, then retry.
  if (res.status === 401 && !options._retry && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...options, _retry: true });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? 'Request failed', data?.details);
  }
  return data as T;
}

let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/* ---- Auth ---- */
export const authApi = {
  register: (body: { name: string; email: string; password: string }) =>
    request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),
};

/* ---- Catalog ---- */
export const catalogApi = {
  get: () => request<{ topics: Catalog['topics']; difficulties: Catalog['difficulties'] }>('/catalog'),
};

/* ---- Sessions ---- */
export const sessionApi = {
  list: () => request<{ sessions: SessionSummary[] }>('/sessions'),
  get: (id: string) => request<{ session: Session }>(`/sessions/${id}`),
  submitAnswer: (id: string, order: number, answer: string) =>
    request<{ session: Session }>(`/sessions/${id}/questions/${order}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
  assist: (id: string, order: number) =>
    request<{ content: string; order: number }>(`/sessions/${id}/questions/${order}/assist`, {
      method: 'POST',
    }),
  complete: (id: string) =>
    request<{ session: Session }>(`/sessions/${id}/complete`, { method: 'POST' }),
};

/**
 * Streams session creation over SSE. Calls `onChunk` with raw text deltas and
 * resolves with the persisted session once the `done` event arrives.
 */
export function createSessionStream(
  body: { topic: string; difficulty: string },
  handlers: {
    onChunk?: (text: string) => void;
    onError?: (message: string) => void;
  } = {}
): Promise<Session> {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(`${API_URL}/sessions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(res.status, data?.message ?? 'Failed to start session');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Parse the SSE stream frame by frame (events separated by a blank line).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          let event = 'message';
          let dataLine = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine);

          if (event === 'chunk') handlers.onChunk?.(payload.text);
          else if (event === 'done') return resolve(payload.session as Session);
          else if (event === 'error') {
            handlers.onError?.(payload.message);
            return reject(new ApiError(500, payload.message));
          }
        }
      }
      reject(new ApiError(500, 'Stream ended unexpectedly'));
    } catch (err) {
      reject(err);
    }
  });
}
