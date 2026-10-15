import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { SupplierProduct, SupplierRequest } from '../api/types';
import { Icon } from '../components/Icon';
import { Tag } from '../components/ui';
import { dateShort, localDateKey, qty, unitLabel } from '../lib/format';
import { useTheme } from '../lib/theme';
import { LoginScreen } from '../screens/LoginScreen';
import { AuthProvider, useAuth } from '../state/auth';

// Кабинет поставщика: отдельная страница /supplier. Поставщик отправляет заявки и видит, что по ним решил менеджер.

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const STATUS = { sent: 'Отправлена', accepted: 'Принята', rejected: 'Отклонена' } as const;
const STATUS_TAG = { sent: 'soon', accepted: 'received', rejected: 'rejected' } as const;

export function SupplierApp() {
  return (
    <AuthProvider portal="supplier">
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { status, session } = useAuth();
  if (status !== 'signed-in' || !session)
    return <LoginScreen title="Кабинет поставщика" lead="Введите ID поставщика, чтобы отправить заявку на поставку." brand="Флагман · поставщикам" />;
  return <SupplierHome />;
}

/** Загрузка с повтором раз в 30 секунд: так поставщик видит решение менеджера без перезагрузки. */
function useLoad<T>(path: string, nonce: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<T>(path)
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e instanceof ApiError ? e.detail : 'Ошибка загрузки'));
    load();
    const t = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [path, nonce]);
  return { data, error };
}

function SupplierHome() {
  const { session, logout } = useAuth();
  const [theme, cycleTheme] = useTheme();
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const products = useLoad<SupplierProduct[]>('/supplier/products', 0);
  const requests = useLoad<SupplierRequest[]>('/supplier/requests', nonce);

  return (
    <div className="portal">
      <header className="portal__head">
        <span className="appnav__logo" aria-hidden>
          <Icon name="layers" />
        </span>
        <div className="portal__title">
          <b>Кабинет поставщика</b>
          <span>{session?.name}</span>
        </div>
        <span className="spacer" />
        <button className="iconbtn" onClick={cycleTheme} aria-label="Сменить тему" title="Сменить тему">
          <Icon name={theme === 'system' ? 'monitor' : theme === 'light' ? 'sun' : 'moon'} />
        </button>
        <button className="btn" onClick={() => void logout()}>
          <Icon name="logout" /> Выйти
        </button>
      </header>
      <main className="portal__body">
        <section className="sheet portal__form">
          <h3>Новая заявка</h3>
          {products.error && <p className="portal__error">{products.error}</p>}
          <RequestForm products={products.data ?? []} onSent={refresh} />
        </section>
        <section className="portal__list">
          <h3 className="section-title">Мои заявки</h3>
          {requests.error && <p className="portal__error">{requests.error}</p>}
          {requests.data === null ? (
            <p className="muted">Загрузка…</p>
          ) : requests.data.length === 0 ? (
            <p className="muted">Заявок пока нет. Заполните форму, и менеджер ресторана увидит её сразу.</p>
          ) : (
            requests.data.map((r) => <RequestCard key={r.id} r={r} />)
          )}
        </section>
      </main>
    </div>
  );
}

interface Line {
  productId: number | '';
  quantity: string;
  expiresOn: string;
}

function defaultExpiry(p: SupplierProduct | undefined): string {
  const hours = p?.defaultShelfLifeHours ?? 72;
  return localDateKey(new Date(Date.now() + hours * 3600_000), TZ);
}

function RequestForm({ products, onSent }: { products: SupplierProduct[]; onSent: () => void }) {
  const [lines, setLines] = useState<Line[]>([{ productId: '', quantity: '', expiresOn: '' }]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const byId = new Map(products.map((p) => [p.id, p]));
  const categories = [...new Set(products.map((p) => p.category))];
  const today = localDateKey(new Date(), TZ);

  const update = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    const body = lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity.replace(',', '.')), expiresOn: l.expiresOn || null }));
    if (body.some((l) => l.productId === '')) return setError('Выберите товар в каждой строке.');
    if (body.some((l) => !Number.isFinite(l.quantity) || l.quantity <= 0)) return setError('Укажите количество больше нуля.');
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<SupplierRequest>('/supplier/requests', { lines: body, comment: comment.trim() || null });
      setLines([{ productId: '', quantity: '', expiresOn: '' }]);
      setComment('');
      setDone(`Заявка ${r.number} отправлена. Менеджер ресторана её уже видит.`);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Не удалось отправить заявку.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={submit} noValidate>
      {lines.map((l, i) => {
        const p = l.productId === '' ? undefined : byId.get(l.productId);
        return (
          <div key={i} className="portal__line">
            <label className="field">
              Товар
              <select
                className="select"
                value={l.productId}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : '';
                  update(i, { productId: id, expiresOn: l.expiresOn || (id === '' ? '' : defaultExpiry(byId.get(id))) });
                }}
              >
                <option value="">Выберите товар</option>
                {categories.map((c) => (
                  <optgroup key={c} label={c}>
                    {products
                      .filter((x) => x.category === c)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field">
              Количество{p ? `, ${unitLabel(p.unit)}` : ''}
              <input className="input" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} placeholder="20" />
            </label>
            <label className="field">
              Годен до
              <input className="input" type="date" min={today} value={l.expiresOn} onChange={(e) => update(i, { expiresOn: e.target.value })} />
            </label>
            {lines.length > 1 && (
              <button type="button" className="btn btn--sm btn--red portal__remove" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Убрать строку">
                <Icon name="x" />
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className="btn btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setLines([...lines, { productId: '', quantity: '', expiresOn: '' }])}>
        <Icon name="plus" /> Ещё товар
      </button>
      <label className="field">
        Комментарий (необязательно)
        <textarea className="input" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: привезём завтра до 10:00" />
      </label>
      {error && <p className="portal__error" role="alert">{error}</p>}
      {done && <p className="portal__ok" role="status">{done}</p>}
      <button className="btn btn--blue" type="submit" disabled={busy}>
        {busy ? 'Отправка…' : 'Отправить заявку'}
      </button>
    </form>
  );
}

function RequestCard({ r }: { r: SupplierRequest }) {
  return (
    <article className="sheet portal__card">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <b>{r.number}</b>
        <Tag kind={STATUS_TAG[r.status]}>{r.partial ? 'Принята частично' : STATUS[r.status]}</Tag>
        <span className="muted">{dateShort(r.createdAt, TZ)}</span>
      </div>
      <ul className="portal__lines">
        {r.lines.map((l) => (
          <li key={l.id}>
            <span>{l.productName}</span>
            <b>
              {r.status === 'accepted' && l.acceptedQuantity !== null
                ? `${qty(l.acceptedQuantity, l.unit)} из ${qty(l.requestedQuantity, l.unit)}`
                : qty(l.requestedQuantity, l.unit)}
            </b>
          </li>
        ))}
      </ul>
      {r.comment && <p className="muted" style={{ margin: 0 }}>Ваш комментарий: {r.comment}</p>}
      {r.status === 'rejected' && r.rejectionReason && <p className="portal__error" style={{ margin: 0 }}>Причина отказа: {r.rejectionReason}</p>}
      {r.status === 'accepted' && r.decidedAt && (
        <p className="muted" style={{ margin: 0 }}>
          Принято {dateShort(r.decidedAt, TZ)}
        </p>
      )}
    </article>
  );
}
