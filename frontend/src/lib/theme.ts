import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'flagman.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171c23' : '#ffffff');
}

/** Тема интерфейса: тёмная (по умолчанию), светлая или «как в системе». Выбор хранится в браузере. */
export function useTheme(): [ThemeChoice, () => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read);

  useEffect(() => {
    apply(choice);
    if (choice !== 'system') return;
    const m = media();
    const on = () => apply('system');
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [choice]);

  const cycle = useCallback(() => {
    setChoice((c) => {
      const next: ThemeChoice = c === 'dark' ? 'light' : c === 'light' ? 'system' : 'dark';
      try {
        if (next === 'dark') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {
        /* хранилище недоступно — тема действует до перезагрузки */
      }
      return next;
    });
  }, []);

  return [choice, cycle];
}
