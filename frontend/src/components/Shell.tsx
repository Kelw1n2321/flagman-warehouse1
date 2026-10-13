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
  stock: 'Остатки, сроки годности и дефицит в реальном времени.',
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

// Плоский список разделов; «Настройки» прижаты к низу меню.
const NAV: NavItem[] = [
  { screen: 'stock', icon: 'box' },
  { screen: 'orders', icon: 'receipt' },
  { screen: 'supplies', icon: 'truck' },
  { screen: 'dishes', icon: 'chef' },
  { screen: 'stop-list', icon: 'stop' },
  { screen: 'hot', icon: 'flame' },
  { screen: 'expiry', icon: 'clock' },
  { screen: 'alerts', icon: 'bell' },
  { screen: 'journal', icon: 'list' },
  { screen: 'stats', icon: 'chart' },
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
  const storage = summary?.settings.mode === 'postgres' ? 'PostgreSQL' : 'демо-база SQLite';

  const item = (n: NavItem) => {
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
  };

  return (
    <aside className={`appnav ${open ? 'is-open' : ''}`} aria-label="Разделы">
      <div className="appnav__brand">
        <span className="appnav__logo" aria-hidden>
          <Icon name="layers" />
        </span>
        <span className="appnav__name">Флагман</span>
        <button className="appnav__collapse" onClick={onCollapse} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
          <Icon name="chevrons" />
        </button>
      </div>
      <nav className="appnav__scroll">{NAV.map(item)}</nav>
      <div className="appnav__bottom">
        {item({ screen: 'settings', icon: 'gear' })}
        <div className="appnav__user" title={`${connected ? 'Склад онлайн, данные обновляются в реальном времени' : 'Нет связи с сервером'} · ${storage}`}>
          <span className="appnav__avatar" aria-hidden>
            АД
            <i className={`dot ${connected ? 'dot--ok' : 'dot--bad'}`} />
          </span>
          <span className="appnav__who">
            <b>Администратор</b>
            <span>{connected ? 'Рабочая смена' : 'Нет связи'}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}

// ───────────────────────── Заголовок экрана ─────────────────────────

const PRIMARY_ACTION: Partial<Record<Screen, { label: string; icon: IconName; to: [Screen, string?] }>> = {
  stock: { label: 'Принять поставку', icon: 'plus', to: ['supplies', 'new'] },
  supplies: { label: 'Новая поставка', icon: 'plus', to: ['supplies', 'new'] },
  'stop-list': { label: 'Что заказать', icon: 'inbox', to: ['supplies', 'recommendations'] },
  orders: { label: 'Новый заказ', icon: 'plus', to: ['orders', 'new'] },
  hot: { label: 'Новый заказ', icon: 'plus', to: ['orders', 'new'] },
  expiry: { label: 'Что приготовить', icon: 'flame', to: ['hot'] },
};

/** Заголовок экрана и общие кнопки: время ресторана, тема, предупреждения, основное действие. */
export function PageHeader({ onMenu }: { onMenu: () => void }) {
  const { route, navigate } = useUi();
  const { summary } = useLive();
  const tz = useTz();
  const now = useClock();
  const [theme, cycleTheme] = useTheme();
  const action = PRIMARY_ACTION[route.screen];
  const alerts = summary?.activeAlerts ?? 0;
  const themeLabel = theme === 'system' ? 'Тема: как в системе' : theme === 'light' ? 'Тема: светлая' : 'Тема: тёмная';

  return (
    <header className="pagehead">
      <button className="iconbtn mobile-only" onClick={onMenu} aria-label="Открыть меню">
        <Icon name="menu" />
      </button>
      <div className="pagehead__title">
        <h1>{SCREEN_TITLES[route.screen]}</h1>
        <p>{SCREEN_SUBTITLES[route.screen]}</p>
      </div>
      <div className="pagehead__actions">
        {/* Сюда экран выносит свои кнопки выдвижных панелей («Фильтры», «Контроль»). */}
        <div id="topbar-slot" className="pagehead__slot" />
        <span className="datepill" title={`${weekday(now, tz)}, ${dayOfMonth(now, tz)} · время ресторана (${tz})`}>
          <Icon name="calendar" />
          Сегодня · {timeOnly(now, tz)}
        </span>
        <button className="iconbtn" onClick={cycleTheme} aria-label={`${themeLabel}. Нажмите, чтобы переключить`} title={`${themeLabel} — нажмите, чтобы переключить`}>
          <Icon name={theme === 'system' ? 'monitor' : theme === 'light' ? 'sun' : 'moon'} />
        </button>
        <button className="iconbtn" onClick={() => navigate('alerts')} aria-label={`Предупреждения: ${alerts} активных`} title="Активные предупреждения">
          <Icon name="bell" />
          {alerts > 0 && <span className="iconbtn__count">{alerts}</span>}
        </button>
        {action && (
          <button className="btn btn--blue" onClick={() => navigate(action.to[0], action.to[1] ?? null)} title={action.label}>
            <Icon name={action.icon} /> <span className="pagehead__label">{action.label}</span>
          </button>
        )}
      </div>
    </header>
  );
}

// ───────────────────────── Нижняя панель (только телефон) ─────────────────────────

const MOBILE_NAV: { screen: Screen; short: string; icon: IconName }[] = [
  { screen: 'stock', short: 'Склад', icon: 'box' },
  { screen: 'orders', short: 'Заказы', icon: 'receipt' },
  { screen: 'supplies', short: 'Поставки', icon: 'truck' },
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
