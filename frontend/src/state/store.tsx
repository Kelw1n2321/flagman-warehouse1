import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { Summary } from '../api/types';

// Живые данные: версия состояния склада (SSE) и сводка

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
    let pending: number | undefined;
    let missed = false;
    // Пачку событий (заказ, генератор, списание) склеиваем в одно обновление; в скрытой вкладке не обновляемся,
    // а догоняем изменения, когда вкладку снова открыли.
    const schedule = () => {
      if (document.hidden) {
        missed = true;
        return;
      }
      window.clearTimeout(pending);
      pending = window.setTimeout(bump, 250);
    };
    const onVisible = () => {
      if (!document.hidden && missed) {
        missed = false;
        bump();
      }
    };
    const connect = () => {
      source = new EventSource('/api/v1/events');
      source.addEventListener('hello', () => {
        setConnected(true);
        schedule(); // после переподключения подтягиваем пропущенные изменения
      });
      source.addEventListener('changed', schedule);
      source.onerror = () => {
        setConnected(false);
        source?.close();
        retry = window.setTimeout(connect, 3000);
      };
    };
    connect();
    document.addEventListener('visibilitychange', onVisible);
    // Резервное обновление: сроки "стареют" даже без событий.
    const poll = window.setInterval(schedule, 60_000);
    return () => {
      source?.close();
      window.clearTimeout(retry);
      window.clearTimeout(pending);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [bump]);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .get<Summary>('/summary', ctrl.signal)
      .then((s) => {
        setSummary((prev) => share(prev, s));
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

// Текущее время (отдельный контекст, чтобы тик не перерисовывал всё дерево)

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

/** Часы с точностью до минуты: перерисовка ровно в начале каждой минуты, а не каждую секунду. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id: number;
    const tick = () => {
      setNow(new Date());
      id = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    id = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => window.clearTimeout(id);
  }, []);
  return now;
}

// Загрузка данных с перезапросом при изменении склада

export interface QueryResult<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Структурное разделение: неизменившиеся части нового ответа заменяются прежними объектами.
 * Тогда карточки, данные которых не поменялись, получают те же ссылки и не перерисовываются.
 */
export function share<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const out = next.map((n, i) => {
      const v = share(prev[i], n);
      if (v !== prev[i]) same = false;
      return v;
    });
    return (same ? prev : out) as T;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = share(prev[k], next[k]);
      if (out[k] !== prev[k]) same = false;
    }
    return (same ? prev : out) as T;
  }
  return next;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

// Кэш последних ответов, чтобы при переходе между вкладками данные показывались сразу.
const queryCache = new Map<string, unknown>();

/** Чистим кэш при выходе. */
export function clearQueryCache() {
  queryCache.clear();
}

const CACHE_LIMIT = 60;

function remember(path: string, data: unknown) {
  queryCache.delete(path);
  queryCache.set(path, data);
  if (queryCache.size > CACHE_LIMIT) queryCache.delete(queryCache.keys().next().value as string);
}

interface QueryState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  key: string | null;
}

export function useQuery<T>(path: string | null): QueryResult<T> {
  const { version } = useLive();
  const [state, setState] = useState<QueryState<T>>(() => ({
    data: path !== null ? (queryCache.get(path) as T | undefined) : undefined,
    error: null,
    loading: path !== null && !queryCache.has(path),
    key: path,
  }));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    // Фоновое обновление уже показанных данных не трогает состояние - лишней перерисовки нет.
    setState((s) => (s.key === path ? s : { data: queryCache.get(path) as T | undefined, error: null, loading: !queryCache.has(path), key: path }));
    api
      .get<T>(path, ctrl.signal)
      .then((fresh) =>
        setState((s) => {
          const data = share(s.key === path ? s.data : (queryCache.get(path) as T | undefined), fresh) as T;
          remember(path, data);
          return s.key === path && s.data === data && !s.loading && !s.error ? s : { data, error: null, loading: false, key: path };
        }),
      )
      .catch((e) => {
        if ((e as Error).name === 'AbortError') return;
        setState((s) => ({ ...s, error: e instanceof ApiError ? e.detail : 'Не удалось загрузить данные', loading: false, key: path }));
      });
    return () => ctrl.abort();
  }, [path, version, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const data = state.key === path ? state.data : path !== null ? (queryCache.get(path) as T | undefined) : undefined;
  return { data, error: state.key === path ? state.error : null, loading: state.loading, reload };
}

// Навигация (hash-роутинг: состояние переживает перезагрузку)

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

// UI: тосты, подтверждения, карточка продукта

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
