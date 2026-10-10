import { ProductModalHost } from './components/ProductModal';
import { BottomNav, Readouts, TopBar } from './components/Shell';
import { ConfirmHost, Toasts } from './components/ui';
import { HotScreen } from './screens/HotScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { AlertsScreen, DishesScreen, ExpiryScreen, JournalScreen, SettingsScreen } from './screens/SecondaryScreens';
import { StatsScreen } from './screens/StatsScreen';
import { StockScreen } from './screens/StockScreen';
import { StopListScreen } from './screens/StopListScreen';
import { SuppliesScreen } from './screens/SuppliesScreen';
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

function Terminal() {
  const { route } = useUi();
  const { summaryError, summary } = useLive();
  const Current = SCREENS[route.screen];
  return (
    <div className="frame">
      <div className="screen">
        <TopBar />
        <BottomNav />
        <Readouts />
        {summaryError && !summary && (
          <div className="toast toast--error" role="alert" style={{ margin: '10px 20px 0' }}>
            <span>Сервер недоступен: {summaryError}. Запустите бэкенд (dotnet run) — интерфейс переподключится автоматически.</span>
          </div>
        )}
        <Current key={route.screen} />
      </div>
      <ProductModalHost />
      <ConfirmHost />
      <Toasts />
    </div>
  );
}

export function App() {
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
