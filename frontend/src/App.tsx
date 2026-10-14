import { useState } from 'react';
import { ProductModalHost } from './components/ProductModal';
import { AppSidebar, BottomNav, PageHeader } from './components/Shell';
import { ConfirmHost, Toasts } from './components/ui';
import { HotScreen } from './screens/HotScreen';
import { LoginScreen } from './screens/LoginScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { AlertsScreen, DishesScreen, ExpiryScreen, JournalScreen, SettingsScreen } from './screens/SecondaryScreens';
import { StatsScreen } from './screens/StatsScreen';
import { StockScreen } from './screens/StockScreen';
import { StopListScreen } from './screens/StopListScreen';
import { SuppliesScreen } from './screens/SuppliesScreen';
import { AuthProvider, useAuth } from './state/auth';
import { LiveProvider, NowProvider, UiProvider, useLive, useUi, type Screen } from './state/store';

const SCREENS: Record<Screen, () => JSX.Element> = {
  stock: StockScreen,
  supplies: SuppliesScreen,
  orders: OrdersScreen,
  'stop-list': StopListScreen,
  hot: HotScreen,
  stats: StatsScreen,
  expiry: ExpiryScreen,
  journal: JournalScreen,
  alerts: AlertsScreen,
  dishes: DishesScreen,
  settings: SettingsScreen,
};

const COLLAPSE_KEY = 'flagman.nav-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function Terminal() {
  const { route } = useUi();
  const { summaryError, summary } = useLive();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [navOpen, setNavOpen] = useState(false);
  const Current = SCREENS[route.screen];

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* хранилище недоступно — состояние действует до перезагрузки */
      }
      return !c;
    });

  return (
    <div className={`frame ${collapsed ? 'is-collapsed' : ''}`}>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <AppSidebar collapsed={collapsed} onCollapse={toggleCollapsed} open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="screen">
        <div className="content">
          <PageHeader onMenu={() => setNavOpen(true)} />
          {summaryError && !summary && (
            <div className="toast toast--error" role="alert">
              <span>Сервер недоступен: {summaryError}. Запустите бэкенд (dotnet run) — интерфейс переподключится автоматически.</span>
            </div>
          )}
          <Current key={route.screen} />
        </div>
      </div>
      <BottomNav />
      <ProductModalHost />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}

/** Склад (и его поток событий) открывается только после входа администратора. */
function Gate() {
  const { status } = useAuth();
  if (status !== 'signed-in') return <LoginScreen />;
  return (
    <LiveProvider>
      <NowProvider>
        <UiProvider>
          <Terminal />
        </UiProvider>
      </NowProvider>
    </LiveProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
