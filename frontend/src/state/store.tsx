import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { Summary } from '../api/types';

// ───────── Живые данные: версия состояния склада (SSE) и сводка ─────────

interface LiveState {
  version: number;
  connected: boolean;
  summary: Summary | null;
  summaryError: string | null;
  /** Принудительное обновление после собственного действия (не ждём SSE). */
  bump: () => void;
}

const LiveContext = createContext<LiveState | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: number | undefined;
    const connect = () => {
      source = new EventSource('/api/v1/events');
      source.addEventListener('hello', () => {
        setConnected(true);
        bump(); // после переподключения подтягиваем пропущенные изменения
      });
      source.addEventListener('changed', () => bump());
      source.onerror = () => {
        setConnected(false);
        source?.close();
        retry = window.setTimeout(connect, 3000);
      };
    };
    connect();
    // Резервное обновление: сроки «стареют» даже без событий.
    const poll = window.setInterval(bump, 60_000);
    return () => {
      source?.close();
      window.clearTimeout(retry);
      window.clearInterval(poll);
    };
  }, [bump]);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .get<Summary>('/summary', ctrl.signal)
      .then((s) => {
        setSummary(s);
        setSummaryError(null);
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setSummaryError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
      });
    return () => ctrl.abort();
  }, [version]);

  const value = useMemo(() => ({ version, connected, summary, summaryError, bump }), [version, connected, summary, summaryError, bump]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('LiveProvider отсутствует');
  return ctx;
}

export function useTz(): string {
  return useLive().summary?.timeZone ?? 'Europe/Moscow';
}

// ───────── Текущее время (отдельный контекст, чтобы тик не перерисовывал всё дерево) ─────────

const NowContext = createContext<Date>(new Date());

export function NowProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export const useNow = () => useContext(NowContext);

export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

// ───────── Загрузка данных с перезапросом при изменении склада ─────────

export interface QueryResult<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useQuery<T>(path: string | null): QueryResult<T> {
  const { version } = useLive();
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean; key: string | null }>({
    data: undefined,
    error: null,
    loading: path !== null,
    key: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, data: s.key === path ? s.data : undefined, error: s.key === path ? s.error : null }));
    api
      .get<T>(path, ctrl.signal)
      .then((data) => setState({ data, error: null, loading: false, key: path }))
      .catch((e) => {
        if ((e as Error).name === 'AbortError') return;
        setState((s) => ({ ...s, error: e instanceof ApiError ? e.detail : 'Не удалось загрузить данные', loading: false, key: path }));
      });
    return () => ctrl.abort();
  }, [path, version, nonce]);

  return { data: state.data, error: state.error, loading: state.loading, reload: () => setNonce((n) => n + 1) };
}

// ───────── Навигация (hash-роутинг: состояние переживает перезагрузку) ─────────

export type Screen =
  | 'stock'
  | 'supplies'
  | 'orders'
  | 'stop-list'
  | 'hot'
  | 'stats'
  | 'expiry'
  | 'journal'
  | 'alerts'
  | 'dishes'
  | 'settings';

const SCREENS: Screen[] = ['stock', 'supplies', 'orders', 'stop-list', 'hot', 'stats', 'expiry', 'journal', 'alerts', 'dishes', 'settings'];

export interface Route {
  screen: Screen;
  param: string | null;
}

function parseHash(): Route {
  const [screen, param] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { screen: SCREENS.includes(screen as Screen) ? (screen as Screen) : 'stock', param: param ? decodeURIComponent(param) : null };
}

export function useRoute(): [Route, (screen: Screen, param?: string | null) => void] {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((screen: Screen, param?: string | null) => {
    window.location.hash = `/${screen}${param ? `/${encodeURIComponent(param)}` : ''}`;
  }, []);
  return [route, navigate];
}

// ───────── UI: тосты, подтверждения, карточка продукта ─────────

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

interface ConfirmRequest {
  title: string;
  text: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiState {
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  confirm: (req: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  confirmRequest: ConfirmRequest | null;
  closeConfirm: (ok: boolean) => void;
  productId: number | null;
  openProduct: (id: number | null) => void;
  navigate: (screen: Screen, param?: string | null) => void;
  route: Route;
  /** Предзаполнение формы поставки (из рекомендаций или карточки продукта). */
  supplyDraft: SupplyDraftLine[] | null;
  startSupply: (lines: SupplyDraftLine[]) => void;
  clearSupplyDraft: () => void;
}

export interface SupplyDraftLine {
  productId: number;
  quantity: number;
  shelfLifeHours: number | null;
}

const UiContext = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmRequest, setConfirm] = useState<ConfirmRequest | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [supplyDraft, setSupplyDraft] = useState<SupplyDraftLine[] | null>(null);
  const [route, navigate] = useRoute();
  const seq = useRef(0);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (text: string, kind: Toast['kind'] = 'ok') => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      window.setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 4000);
    },
    [dismissToast],
  );
  const confirm = useCallback(
    (req: Omit<ConfirmRequest, 'resolve'>) => new Promise<boolean>((resolve) => setConfirm({ ...req, resolve })),
    [],
  );
  const closeConfirm = useCallback((ok: boolean) => {
    setConfirm((c) => {
      c?.resolve(ok);
      return null;
    });
  }, []);
  const startSupply = useCallback(
    (lines: SupplyDraftLine[]) => {
      setSupplyDraft(lines);
      setProductId(null);
      navigate('supplies', 'new');
    },
    [navigate],
  );

  const value = useMemo<UiState>(
    () => ({
      toasts,
      toast,
      dismissToast,
      confirm,
      confirmRequest,
      closeConfirm,
      productId,
      openProduct: setProductId,
      navigate,
      route,
      supplyDraft,
      startSupply,
      clearSupplyDraft: () => setSupplyDraft(null),
    }),
    [toasts, toast, dismissToast, confirm, confirmRequest, closeConfirm, productId, navigate, route, supplyDraft, startSupply],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('UiProvider отсутствует');
  return ctx;
}

/** Выполняет команду: блокирует повторное нажатие, показывает результат, обновляет данные. */
export function useAction() {
  const { toast } = useUi();
  const { bump } = useLive();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast(typeof success === 'function' ? success(r) : success, 'ok');
        bump();
        return r;
      } catch (e) {
        toast(e instanceof ApiError ? e.detail : 'Операция не выполнена', 'error');
        bump();
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast, bump],
  );
  return { run, busy };
}
