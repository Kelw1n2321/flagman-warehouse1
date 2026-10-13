import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dayOfMonth, timeOnly, weekday } from '../lib/format';
import { useTheme } from '../lib/theme';
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

const SCREEN_SUBTITLES: Record<Screen, string> = {
  stock: 'Остатки по продуктам и партиям, сроки годности и дефицит в реальном времени.',
  supplies: 'Приёмка поставок: каждая строка становится отдельной партией со своим сроком.',
  orders: 'Доступность блюд по остаткам продуктов и срокам годности.',
  'stop-list': 'Блюда, которые нельзя приготовить из доступных остатков, и прогноз новых стопов.',
  hot: 'Что продвигать, чтобы использовать продукты до окончания срока годности.',
  stats: 'Поступления, списания, отказы и прогноз дефицита по реальным данным склада.',
  expiry: 'Все партии по ближайшему сроку: норма, скоро истекает, критично, просрочено.',
  journal: 'Каждое изменение остатка партии — приёмка, расход, списание, корректировка.',
  alerts: 'Текущие предупреждения и история: условия закрываются автоматически.',
  dishes: 'Состав блюд на порцию. Изменение рецептуры сразу пересчитывает стоп-лист.',
  settings: 'Пороги сроков, часовой пояс, автосписание и генератор событий.',
};

// ───────────────────────── Боковое меню ─────────────────────────

interface NavItem {
  screen: Screen;
  icon: IconName;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Основное',
    items: [
      { screen: 'stock', icon: 'box' },
      { screen: 'supplies', icon: 'truck' },
      { screen: 'orders', icon: 'receipt' },
      { screen: 'stop-list', icon: 'stop' },
      { screen: 'hot', icon: 'flame' },
      { screen: 'stats', icon: 'chart' },
    ],
  },
  {
    title: 'Контроль',
    items: [
      { screen: 'expiry', icon: 'clock' },
      { screen: 'journal', icon: 'list' },
      { screen: 'alerts', icon: 'bell' },
    ],
  },
  {
    title: 'Справочники',
    items: [
      { screen: 'dishes', icon: 'chef' },
      { screen: 'settings', icon: 'gear' },
    ],
  },
];

function useBadges(): Partial<Record<Screen, { value: number; tone: 'crit' | 'warn' | 'info' }>> {
  const { summary: s } = useLive();
  if (!s) return {};
  return {
    'stop-list': { value: s.stopListCount, tone: 'crit' },
    hot: { value: s.hotOffers, tone: 'warn' },
    expiry: { value: s.criticalBatches + s.expiredBatches, tone: 'crit' },
    alerts: { value: s.activeAlerts, tone: 'info' },
  };
}

export function AppSidebar({ collapsed, onCollapse, open, onClose }: { collapsed: boolean; onCollapse: () => void; open: boolean; onClose: () => void }) {
  const { route, navigate } = useUi();
  const { summary, connected } = useLive();
  const badges = useBadges();

  return (
    <aside className={`appnav ${open ? 'is-open' : ''}`} aria-label="Разделы">
      <div className="appnav__brand">
        <span className="appnav__logo" aria-hidden>
          Ф
        </span>
        <span className="appnav__name">Флагман</span>
        <button className="appnav__collapse" onClick={onCollapse} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
          <Icon name="chevrons" />
        </button>
      </div>
      <nav className="appnav__scroll">
        {GROUPS.map((g) => (
          <div key={g.title} className="appnav__group">
            <div className="appnav__title">{g.title}</div>
            {g.items.map((n) => {
              const b = badges[n.screen];
              const active = route.screen === n.screen;
              return (
                <button
                  key={n.screen}
                  className={`appnav__item ${active ? 'is-active' : ''}`}
                  onClick={() => (navigate(n.screen), onClose())}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? SCREEN_TITLES[n.screen] : undefined}
                >
                  <Icon name={n.icon} />
                  <span className="appnav__label">{SCREEN_TITLES[n.screen]}</span>
                  {!!b?.value && <span className={`appnav__badge appnav__badge--${b.tone}`}>{b.value}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="appnav__status" title={summary?.settings.mode === 'postgres' ? 'Хранилище: PostgreSQL' : 'Хранилище: демо-база SQLite'}>
        <div className="appnav__status-row">
          <i className={`dot ${connected ? 'dot--ok' : 'dot--bad'}`} />
          <b>{connected ? 'Склад онлайн' : 'Нет связи'}</b>
        </div>
        <span>{summary?.settings.mode === 'postgres' ? 'PostgreSQL · обновления в реальном времени' : 'Демо-режим · данные обновляются в реальном времени'}</span>
      </div>
    </aside>
  );
}

// ───────────────────────── Верхняя панель ─────────────────────────

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { navigate, route } = useUi();
  const { summary } = useLive();
  const alerts = summary?.activeAlerts ?? 0;
  const [theme, cycleTheme] = useTheme();
  const themeLabel = theme === 'system' ? 'Тема: как в системе' : theme === 'light' ? 'Тема: светлая' : 'Тема: тёмная';

  return (
    <header className="topbar">
      <button className="iconbtn mobile-only" onClick={onMenu} aria-label="Открыть меню">
        <Icon name="menu" />
      </button>
      <div className="crumbs" aria-label="Текущий раздел">
        <span>Склад ресторана</span>
        <Icon name="chevron" />
        <b>{SCREEN_TITLES[route.screen]}</b>
      </div>
      <div className="topbar__right">
        {/* Сюда экран выносит свои кнопки выдвижных панелей («Фильтры», «Контроль»). */}
        <div id="topbar-slot" className="topbar__slot" />
        <button className="iconbtn" onClick={cycleTheme} aria-label={`${themeLabel}. Нажмите, чтобы переключить`} title={`${themeLabel} — нажмите, чтобы переключить`}>
          <Icon name={theme === 'system' ? 'monitor' : theme === 'light' ? 'sun' : 'moon'} />
        </button>
        <button className="iconbtn" onClick={() => navigate('alerts')} aria-label={`Предупреждения: ${alerts} активных`} title="Активные предупреждения">
          <Icon name="bell" />
          {alerts > 0 && <span className="iconbtn__count">{alerts}</span>}
        </button>
      </div>
    </header>
  );
}

// ───────────────────────── Заголовок экрана ─────────────────────────

const PRIMARY_ACTION: Partial<Record<Screen, { label: string; icon: IconName; to: [Screen, string?] }>> = {
  stock: { label: 'Принять поставку', icon: 'truck', to: ['supplies', 'new'] },
  supplies: { label: 'Новая поставка', icon: 'plus', to: ['supplies', 'new'] },
  'stop-list': { label: 'Что заказать', icon: 'inbox', to: ['supplies', 'recommendations'] },
  orders: { label: 'Новый заказ', icon: 'plus', to: ['orders', 'new'] },
  hot: { label: 'Новый заказ', icon: 'receipt', to: ['orders', 'new'] },
  expiry: { label: 'Что приготовить', icon: 'flame', to: ['hot'] },
};

export function PageHeader() {
  const { route, navigate } = useUi();
  const tz = useTz();
  const now = useClock();
  const action = PRIMARY_ACTION[route.screen];
  return (
    <div className="pagehead">
      <div>
        <h1>{SCREEN_TITLES[route.screen]}</h1>
        <p>{SCREEN_SUBTITLES[route.screen]}</p>
      </div>
      <div className="pagehead__actions">
        <span className="datepill" title={`Время ресторана · ${tz}`}>
          <Icon name="calendar" />
          {weekday(now, tz).toLowerCase()}, {dayOfMonth(now, tz)} · {timeOnly(now, tz)}
        </span>
        {action && (
          <button className="btn btn--blue" onClick={() => navigate(action.to[0], action.to[1] ?? null)}>
            <Icon name={action.icon} /> {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Нижняя панель (только телефон) ─────────────────────────

const MOBILE_NAV: { screen: Screen; short: string; icon: IconName }[] = [
  { screen: 'stock', short: 'Склад', icon: 'box' },
  { screen: 'supplies', short: 'Поставки', icon: 'truck' },
  { screen: 'orders', short: 'Заказы', icon: 'receipt' },
  { screen: 'stop-list', short: 'Стоп', icon: 'stop' },
  { screen: 'hot', short: 'Горячее', icon: 'flame' },
  { screen: 'stats', short: 'Отчёты', icon: 'chart' },
];

export function BottomNav() {
  const { route, navigate } = useUi();
  const badges = useBadges();
  return (
    <nav className="bottombar" aria-label="Основные разделы">
      {MOBILE_NAV.map((n) => {
        const b = badges[n.screen];
        return (
          <button key={n.screen} className={`navbtn ${route.screen === n.screen ? 'is-active' : ''}`} onClick={() => navigate(n.screen)} aria-current={route.screen === n.screen ? 'page' : undefined}>
            <Icon name={n.icon} />
            <span>{n.short}</span>
            {!!b?.value && <span className="badge">{b.value}</span>}
          </button>
        );
      })}
    </nav>
  );
}

// ───────────────────────── Рабочая область экрана ─────────────────────────

/** Фильтры | содержимое | правая панель. На узких экранах боковые панели выдвижные. */
export function Workspace({ sidebar, right, rightLabel = 'Контроль', rightCount, children }: {
  sidebar?: ReactNode;
  right?: ReactNode;
  rightLabel?: string;
  rightCount?: number;
  children: ReactNode;
}) {
  const [left, setLeft] = useState(false);
  const [rightOpen, setRight] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const { route } = useUi();
  useEffect(() => {
    setLeft(false);
    setRight(false);
  }, [route.screen, route.param]);
  useEffect(() => setSlot(document.getElementById('topbar-slot')), []);

  const toggles = (
    <>
      {sidebar && (
        <button className="btn btn--sm mobile-only" onClick={() => setLeft(true)}>
          <Icon name="filter" /> Фильтры
        </button>
      )}
      {right && (
        <button className="btn btn--sm drawer-toggle" onClick={() => setRight(true)}>
          <Icon name="panel" /> {rightLabel}
          {rightCount ? <span className="btn__count">{rightCount}</span> : null}
        </button>
      )}
    </>
  );

  return (
    <div className={`workspace ${right ? '' : 'workspace--wide'} ${sidebar ? '' : 'workspace--nofilters'}`}>
      {(left || rightOpen) && <div className="scrim" onClick={() => (setLeft(false), setRight(false))} />}
      {sidebar && (
        <aside className={`sidebar ${left ? 'is-open' : ''}`} aria-label="Поиск и фильтры">
          {sidebar}
        </aside>
      )}
      <main className="col" style={{ minWidth: 0 }}>
        {slot && createPortal(toggles, slot)}
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
