import type { Screen } from '../state/store';

export type Role = 'manager' | 'waiter' | 'supplier';

/** Разделы, которые видит официант. Остальное (склад, поставки, сроки, журнал, настройки) - только менеджеру. */
const WAITER_SCREENS: Screen[] = ['orders', 'hot', 'stop-list', 'dishes'];

export function can(role: Role | undefined, screen: Screen): boolean {
  if (role === 'manager') return true;
  if (role === 'waiter') return WAITER_SCREENS.includes(screen);
  return false;
}

export function homeScreen(role: Role | undefined): Screen {
  return role === 'waiter' ? 'orders' : 'stock';
}

export const ROLE_LABEL: Record<Role, string> = {
  manager: 'Менеджер',
  waiter: 'Официант',
  supplier: 'Поставщик',
};
