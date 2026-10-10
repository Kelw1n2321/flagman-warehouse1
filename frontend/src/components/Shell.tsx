import { useEffect, useState, type ReactNode } from 'react';
import { dayOfMonth, timeOnly, weekday } from '../lib/format';
import { useClock, useLive, useTz, useUi, type Screen } from '../state/store';
import { Icon, type IconName } from './Icon';

export const SCREEN_TITLES: Record<Screen, string> = {
  stock: 'Склад',
  supplies: 'Поставки',
  orders: 'Заказы',
  'stop-list': 'Стоп-лист',
  hot: 'Горячие предложения',
  stats: 'Статистика',
  expiry: 'Сроки годности',
  journal: 'Журнал движения',
  alerts: 'Предупреждения',
  dishes: 'Блюда и рецептуры',
  settings: 'Настройки',
};

export function TopBar() {
  const { route, navigate } = useUi();
  const { summary, connected } = useLive();
  const tz = useTz();
  const now = useClock();
  const alerts = summary?.activeAlerts ?? 0;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__logo" aria-hidden>
          Ф
        </span>
        <span>
          <div className="brand__name">Флагман</div>
          <div className="brand__sub">Склад ресторана</div>
        </span>
      </div>
      <h1>{SCREEN_TITLES[route.screen]}</h1>
      <div className="topbar__right">
        <span
          className="conn"
          title={
            (connected ? 'Обновления в реальном времени подключены' : 'Нет связи с сервером, переподключение…') +
            (summary?.settings.mode === 'postgres' ? ' · PostgreSQL' : ' · демо-режим (SQLite)')
          }
        >
          <i className={`dot ${connected ? 'dot--ok' : 'dot--bad'}`} /> <span>{connected ? 'Онлайн' : 'Нет связи'}</span>
        </span>
        <div className="clock" aria-label="Время ресторана">
          <b>{timeOnly(now, tz)}</b>
          <small>
            {weekday(now, tz).toLowerCase()}, {dayOfMonth(now, tz)} · {tz.split('/').pop()?.replace('_', ' ')}
          </small>
        </div>
        <button
          className="bell"
          onClick={() => navigate('alerts')}
          aria-label={`Предупреждения: ${alerts} активных`}
          title="Активные предупреждения"
        >
          <Icon name="bell" />
          {alerts > 0 && <span className="bell__count">{alerts}</span>}
        </button>
      </div>
    </header>
  );
}

export function Readouts() {
  const { summary } = useLive();
  const { navigate } = useUi();
  if (!summary) return <div className="readouts" style={{ minHeight: 34 }} />;
  const items: { sq: string; label: string; value: ReactNode; go: () => void; title: string }[] = [
    { sq: 'green', label: 'В наличии', value: `${summary.productsInStock}/${summary.productCount}`, go: () => navigate('stock'), title: 'Продуктов с доступным остатком' },
    { sq: 'gray', label: 'Партий', value: summary.activeBatches, go: () => navigate('expiry'), title: 'Активных партий' },
    { sq: 'yellow', label: 'Истекает', value: summary.expiringBatches + summary.criticalBatches, go: () => navigate('expiry'), title: 'Партий со сроком в зоне риска' },
    { sq: 'red', label: 'Просрочено', value: summary.expiredBatches, go: () => navigate('expiry'), title: 'Партий с истёкшим сроком на складе' },
    { sq: 'red', label: 'Стоп-лист', value: `${summary.stopListCount}/${summary.dishCount}`, go: () => navigate('stop-list'), title: 'Блюд в стоп-листе' },
    { sq: 'blue', label: 'Заказов сегодня', value: `${summary.ordersToday} / отказов ${summary.rejectedToday}`, go: () => navigate('orders'), title: 'Выполнено · отклонено сегодня' },
  ];
  return (
    <div className="readouts" aria-label="Сводка склада">
      {items.map((i) => (
        <button key={i.label} onClick={i.go} title={i.title}>
          <span className={`sq sq--${i.sq}`} aria-hidden />
          {i.label} <b>{i.value}</b>
        </button>
      ))}
    </div>
  );
}

const NAV: { screen: Screen; label: string; short: string; icon: IconName }[] = [
  { screen: 'stock', label: 'Склад', short: 'Склад', icon: 'box' },
  { screen: 'supplies', label: 'Поставки', short: 'Поставки', icon: 'truck' },
  { screen: 'orders', label: 'Заказы', short: 'Заказы', icon: 'receipt' },
  { screen: 'stop-list', label: 'Стоп-лист', short: 'Стоп', icon: 'stop' },
  { screen: 'hot', label: 'Горячие предложения', short: 'Горячее', icon: 'flame' },
  { screen: 'stats', label: 'Статистика', short: 'Отчёты', icon: 'chart' },
];

export function BottomNav() {
  const { route, navigate } = useUi();
  const { summary } = useLive();
  const badge = (s: Screen) => (s === 'stop-list' ? summary?.stopListCount : s === 'hot' ? summary?.hotOffers : 0) || 0;
  return (
    <nav className="bottombar" aria-label="Разделы">
      {NAV.map((n) => (
        <button
          key={n.screen}
          className={`navbtn ${route.screen === n.screen ? 'is-active' : ''}`}
          onClick={() => navigate(n.screen)}
          aria-current={route.screen === n.screen ? 'page' : undefined}
        >
          <Icon name={n.icon} />
          <span className="navbtn__full">{n.label}</span>
          <span className="navbtn__short">{n.short}</span>
          {badge(n.screen) > 0 && <span className="badge">{badge(n.screen)}</span>}
        </button>
      ))}
    </nav>
  );
}

/** Рабочая область: левая панель | центр | правая панель. На узких экранах боковые — выдвижные. */
export function Workspace({ sidebar, right, rightLabel = 'Контроль', rightCount, children }: {
  sidebar: ReactNode;
  right?: ReactNode;
  rightLabel?: string;
  rightCount?: number;
  children: ReactNode;
}) {
  const [left, setLeft] = useState(false);
  const [rightOpen, setRight] = useState(false);
  const { route } = useUi();
  useEffect(() => {
    setLeft(false);
    setRight(false);
  }, [route.screen, route.param]);

  return (
    <div className={`workspace ${right ? '' : 'workspace--wide'}`}>
      {(left || rightOpen) && <div className="scrim" onClick={() => (setLeft(false), setRight(false))} />}
      <aside className={`sidebar ${left ? 'is-open' : ''}`} aria-label="Поиск и фильтры">
        {sidebar}
      </aside>
      <main className="col" style={{ minWidth: 0 }}>
        <div className="ws-toggles">
          <button className="btn btn--sm mobile-only" onClick={() => setLeft(true)}>
            <Icon name="menu" /> Фильтры
          </button>
          <span className="spacer" />
          {right && (
            <button className="btn btn--sm btn--blue drawer-toggle" onClick={() => setRight(true)}>
              <Icon name="panel" /> {rightLabel}
              {rightCount ? ` (${rightCount})` : ''}
            </button>
          )}
        </div>
        {children}
      </main>
      {right && (
        <aside className={`rightbar ${rightOpen ? 'is-open' : ''}`} aria-label={rightLabel}>
          {rightOpen && (
            <button className="btn btn--sm drawer-toggle" style={{ alignSelf: 'flex-end' }} onClick={() => setRight(false)}>
              <Icon name="x" /> Закрыть
            </button>
          )}
          {right}
        </aside>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Поиск…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <span className="sr-only">{placeholder}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" />
      <Icon name="search" />
    </label>
  );
}

const SECTIONS: { screen: Screen; icon: IconName }[] = [
  { screen: 'expiry', icon: 'clock' },
  { screen: 'journal', icon: 'list' },
  { screen: 'alerts', icon: 'bell' },
  { screen: 'dishes', icon: 'chef' },
  { screen: 'settings', icon: 'gear' },
];

export function SectionNav() {
  const { route, navigate } = useUi();
  const { summary } = useLive();
  return (
    <>
      <h3>Разделы</h3>
      {SECTIONS.map((s) => (
        <button
          key={s.screen}
          className={`side-btn side-btn--nav ${route.screen === s.screen ? 'is-active' : ''}`}
          onClick={() => navigate(s.screen)}
        >
          <Icon name={s.icon} />
          <span style={{ flex: 1 }}>{SCREEN_TITLES[s.screen]}</span>
          {s.screen === 'alerts' && !!summary?.activeAlerts && <span className="count">{summary.activeAlerts}</span>}
          {s.screen === 'expiry' && !!summary && summary.criticalBatches + summary.expiredBatches > 0 && (
            <span className="count">{summary.criticalBatches + summary.expiredBatches}</span>
          )}
        </button>
      ))}
    </>
  );
}



export function CategoryList({ value, onChange, counts }: { value: string; onChange: (c: string) => void; counts?: Record<string, number> }) {
  const { summary } = useLive();
  const cats = summary?.categories ?? [];
  return (
    <>
      <h3>Категории</h3>
      <button className={`side-btn ${value === '' ? 'is-active' : ''}`} onClick={() => onChange('')}>
        <span style={{ flex: 1 }}>Все категории</span>
      </button>
      {cats.map((c) => (
        <button key={c} className={`side-btn ${value === c ? 'is-active' : ''}`} onClick={() => onChange(c)} aria-pressed={value === c}>
          <span style={{ flex: 1 }}>{c}</span>
          {counts && <span className="count">{counts[c] ?? 0}</span>}
        </button>
      ))}
    </>
  );
}
