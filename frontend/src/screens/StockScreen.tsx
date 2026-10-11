import { useState } from 'react';
import type { Batch, Product } from '../api/types';
import { BatchCard, ProductCard } from '../components/Cards';
import { ControlPanel } from '../components/ControlPanel';
import { CategoryList, SearchBox, SectionNav, Workspace } from '../components/Shell';
import { EmptyState, ErrorState, LoadingBar, LoadingGrid } from '../components/ui';
import { useLive, useNow, useQuery, useTz, useUi } from '../state/store';

export type StockFilter = 'all' | 'in-stock' | 'low' | 'expiring' | 'expired' | 'insufficient';
type Sort = 'name' | 'quantity' | 'expiry' | 'risk';

export const FILTERS: { key: StockFilter; label: string; test: (p: Product) => boolean }[] = [
  { key: 'all', label: 'Все продукты', test: () => true },
  { key: 'in-stock', label: 'В наличии', test: (p) => p.available > 0 },
  { key: 'low', label: 'Малый остаток', test: (p) => p.belowMinimum },
  { key: 'expiring', label: 'Истекает срок', test: (p) => p.expiringSoon + p.expiringCritical > 0 },
  { key: 'expired', label: 'Просрочено', test: (p) => p.expired > 0 },
  { key: 'insufficient', label: 'Не хватает для блюд', test: (p) => p.blockedDishes.length > 0 },
];

const SORTS: { key: Sort; label: string }[] = [
  { key: 'risk', label: 'По уровню риска' },
  { key: 'expiry', label: 'По сроку годности' },
  { key: 'quantity', label: 'По количеству (к минимуму)' },
  { key: 'name', label: 'По названию' },
];

function sortProducts(list: Product[], sort: Sort): Product[] {
  const s = [...list];
  const exp = (p: Product) => (p.earliestExpiry ? Date.parse(p.earliestExpiry) : Number.MAX_SAFE_INTEGER);
  switch (sort) {
    case 'name':
      return s.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    case 'quantity':
      return s.sort((a, b) => (a.minStock ? a.available / a.minStock : a.available) - (b.minStock ? b.available / b.minStock : b.available));
    case 'expiry':
      return s.sort((a, b) => exp(a) - exp(b));
    default:
      return s.sort((a, b) => b.riskLevel - a.riskLevel || exp(a) - exp(b));
  }
}

export function matches(p: { name: string; sku?: string; id?: number }, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return p.name.toLowerCase().includes(t) || (p.sku ?? '').toLowerCase().includes(t) || String(p.id ?? '') === t;
}

export function StockScreen() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [sort, setSort] = useState<Sort>('risk');
  const [view, setView] = useState<'products' | 'batches'>('products');
  const stock = useQuery<Product[]>('/stock');
  const batches = useQuery<Batch[]>(view === 'batches' ? '/batches' : null);
  const { openProduct, productId } = useUi();
  const { summary } = useLive();
  const tz = useTz();
  const now = useNow();
  const soon = summary?.settings.soonHours ?? 72;

  const all = stock.data ?? [];
  const inCategory = all.filter((p) => !category || p.category === category);
  const filterFn = FILTERS.find((f) => f.key === filter)!.test;
  const visible = sortProducts(inCategory.filter((p) => filterFn(p) && matches(p, search)), sort);
  const visibleIds = new Set(visible.map((p) => p.id));
  const batchList = (batches.data ?? []).filter((b) => visibleIds.has(b.productId));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, inCategory.filter(f.test).length]));
  const catCounts = all.reduce<Record<string, number>>((acc, p) => ((acc[p.category] = (acc[p.category] ?? 0) + 1), acc), {});

  return (
    <Workspace
      rightCount={summary?.activeAlerts}
      sidebar={
        <>
          <SearchBox value={search} onChange={setSearch} placeholder="Название или артикул…" />
          <div className="sidebar__scroll">
            <CategoryList value={category} onChange={setCategory} counts={catCounts} />
            <h3>Состояние</h3>
            {FILTERS.map((f) => (
              <button key={f.key} className={`side-btn ${filter === f.key ? 'is-active' : ''}`} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}>
                <span style={{ flex: 1, textAlign: 'left' }}>{f.label}</span>
                <span className="count">{counts[f.key]}</span>
              </button>
            ))}
            <SectionNav />
          </div>
        </>
      }
      right={<ControlPanel />}
    >
      <div className="toolbar">
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Сортировка">
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Режим отображения">
          <button className={view === 'products' ? 'is-active' : ''} onClick={() => setView('products')} aria-pressed={view === 'products'}>
            Общий остаток
          </button>
          <button className={view === 'batches' ? 'is-active' : ''} onClick={() => setView('batches')} aria-pressed={view === 'batches'}>
            По партиям
          </button>
        </div>
      </div>
      <LoadingBar active={stock.loading || batches.loading} />
      <div className="tray">
        {stock.error && !stock.data ? (
          <ErrorState text={stock.error} onRetry={stock.reload} />
        ) : !stock.data ? (
          <LoadingGrid />
        ) : view === 'products' ? (
          visible.length === 0 ? (
            <EmptyState
              icon="search"
              title="Ничего не найдено"
              text="Измените поиск, категорию или фильтр состояния."
              action={
                <button className="btn btn--sm" onClick={() => (setSearch(''), setCategory(''), setFilter('all'))}>
                  Сбросить фильтры
                </button>
              }
            />
          ) : (
            <div className="grid">
              {visible.map((p) => (
                <ProductCard key={p.id} p={p} tz={tz} now={now} soonHours={soon} selected={productId === p.id} onOpen={() => openProduct(p.id)} />
              ))}
            </div>
          )
        ) : !batches.data ? (
          <LoadingGrid />
        ) : batchList.length === 0 ? (
          <EmptyState icon="box" title="Нет активных партий" text="Для выбранных продуктов нет партий с остатком." />
        ) : (
          <div className="grid">
            {batchList.map((b) => (
              <BatchCard key={b.id} b={b} tz={tz} now={now} onOpen={() => openProduct(b.productId)} />
            ))}
          </div>
        )}
      </div>
    </Workspace>
  );
}
