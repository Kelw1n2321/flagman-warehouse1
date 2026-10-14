import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, UNAUTHORIZED_EVENT } from '../api/client';
import { clearQueryCache } from './store';

/** Вошедший администратор: имя и хвост ID (сам ID на экран не выводится). */
export interface Session {
  name: string;
  idHint: string;
}

type AuthStatus = 'checking' | 'anonymous' | 'signed-in' | 'offline';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  /** Причина, по которой показан экран входа (сессия истекла и т. п.). */
  notice: string | null;
  login: (id: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // При открытии страницы: действует ли ещё cookie прошлого входа.
  useEffect(() => {
    let alive = true;
    setStatus('checking');
    api
      .get<Session>('/auth/me')
      .then((s) => {
        if (!alive) return;
        setSession(s);
        setStatus('signed-in');
      })
      .catch((e) => {
        if (!alive) return;
        setSession(null);
        setStatus(e instanceof ApiError && e.status === 0 ? 'offline' : 'anonymous');
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  // Любой запрос получил 401 — сессия закончилась: возвращаемся на экран входа.
  useEffect(() => {
    const onUnauthorized = () => {
      clearQueryCache();
      setSession(null);
      setStatus((s) => {
        if (s === 'signed-in') setNotice('Сессия завершена. Войдите снова.');
        return 'anonymous';
      });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (id: string) => {
    const s = await api.post<Session>('/auth/login', { id });
    clearQueryCache();
    setNotice(null);
    setSession(s);
    setStatus('signed-in');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearQueryCache();
      setSession(null);
      setNotice(null);
      setStatus('anonymous');
    }
  }, []);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const value = useMemo(() => ({ status, session, notice, login, logout, retry }), [status, session, notice, login, logout, retry]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider отсутствует');
  return ctx;
}
