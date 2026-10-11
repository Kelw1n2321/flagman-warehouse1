import { useEffect, useRef, type ReactNode } from 'react';

// Стек открытых окон: Esc закрывает только верхнее.
const modalStack: number[] = [];
let modalSeq = 0;
import { useUi } from '../state/store';
import { Icon, isIconName } from './Icon';

export function Emoji({ children, label }: { children: string; label?: string }) {
  return (
    <span className="emoji" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {children}
    </span>
  );
}

export function Tag({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`tag tag--${kind}`}>{children}</span>;
}

/** Модальное окно в стиле игрового окна: белая рамка, красный «крестик», фокус и Esc. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
  icon,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md';
  icon?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = ++modalSeq;
    modalStack.push(id);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
      prev?.focus?.();
    };
  }, []);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ? `modal--${size}` : ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <div className="modal__head">
          {icon && <span className="modal__icon">{isIconName(icon) ? <Icon name={icon} /> : <Emoji>{icon}</Emoji>}</span>}
          <h2>{title}</h2>
          <button className="close-x" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const { confirmRequest, closeConfirm } = useUi();
  if (!confirmRequest) return null;
  return (
    <Modal
      title={confirmRequest.title}
      onClose={() => closeConfirm(false)}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={() => closeConfirm(false)}>
            Отмена
          </button>
          <button className={`btn ${confirmRequest.danger ? 'btn--red' : 'btn--blue'}`} onClick={() => closeConfirm(true)} autoFocus>
            {confirmRequest.confirmLabel ?? 'Подтвердить'}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 15 }}>{confirmRequest.text}</p>
    </Modal>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useUi();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Скрыть">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, text, dark, action }: { icon?: string; title: string; text?: string; dark?: boolean; action?: ReactNode }) {
  return (
    <div className={`state ${dark ? 'state--dark' : ''}`}>
      <span className="state__icon">{isIconName(icon) ? <Icon name={icon} /> : <Emoji>{icon}</Emoji>}</span>
      <b>{title}</b>
      {text && <span>{text}</span>}
      {action}
    </div>
  );
}

export function ErrorState({ text, onRetry, dark }: { text: string; onRetry?: () => void; dark?: boolean }) {
  return (
    <div className={`state ${dark ? 'state--dark' : ''}`} role="alert">
      <span className="state__icon state__icon--error">
        <Icon name="alert" />
      </span>
      <b>Не удалось загрузить</b>
      <span>{text}</span>
      {onRetry && (
        <button className="btn btn--sm" onClick={onRetry}>
          <Icon name="refresh" /> Повторить
        </button>
      )}
    </div>
  );
}

export function LoadingGrid({ count = 9 }: { count?: number }) {
  return (
    <div className="grid" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function LoadingBar({ active }: { active: boolean }) {
  return <div className="loading-bar" style={{ visibility: active ? 'visible' : 'hidden' }} aria-hidden />;
}

/** Обёртка загрузки: первый раз — скелет, потом — данные (перезапрос не мигает). */
export function Loadable<T>({
  q,
  children,
  skeleton,
  dark,
}: {
  q: { data: T | undefined; error: string | null; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
  dark?: boolean;
}) {
  if (q.data !== undefined) return <>{children(q.data)}</>;
  if (q.error) return <ErrorState text={q.error} onRetry={q.reload} dark={dark} />;
  return <>{skeleton ?? <EmptyState icon="clock" title="Загрузка…" dark={dark} />}</>;
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar" role="presentation">
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}
