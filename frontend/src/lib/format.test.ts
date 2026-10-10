import { describe, expect, it } from 'vitest';
import { compact, hoursLeft, humanDate, localDateKey, qty, riskTier, toLocalInput } from './format';

describe('qty', () => {
  it('показывает мелкие кг/л в граммах и миллилитрах', () => {
    expect(qty(0.08, 'l')).toBe('80 мл');
    expect(qty(0.025, 'kg')).toBe('25 г');
  });
  it('оставляет крупные значения и штуки как есть', () => {
    expect(qty(18.5, 'kg')).toBe('18,5 кг');
    expect(qty(34, 'pcs')).toBe('34 шт');
    expect(qty(0.5, 'kg', { small: false })).toBe('0,5 кг');
  });
});

describe('compact', () => {
  it('сокращает точность по мере роста числа', () => {
    expect(compact(0)).toBe('0');
    expect(compact(1.234)).toBe('1,23');
    expect(compact(18.55)).toBe('18,6');
    expect(compact(180)).toBe('180');
  });
});

describe('hoursLeft', () => {
  it('форматирует минуты, часы и дни', () => {
    expect(hoursLeft(0.5)).toBe('30 мин');
    expect(hoursLeft(10)).toBe('10 ч');
    expect(hoursLeft(60)).toBe('2 д 12 ч');
    expect(hoursLeft(-3)).toBe('−3 ч');
  });
});

describe('даты в часовом поясе ресторана', () => {
  // 20:30 UTC 10 октября = 23:30 по Москве (ещё 10-е), но уже 11-е во Владивостоке (UTC+10).
  const now = new Date('2026-10-10T20:30:00Z');

  it('определяет календарный день по часовому поясу, а не по UTC', () => {
    expect(localDateKey(now, 'Europe/Moscow')).toBe('2026-10-10');
    expect(localDateKey(now, 'Asia/Vladivostok')).toBe('2026-10-11');
  });

  it('называет «сегодня/завтра» относительно границы суток ресторана', () => {
    const at = '2026-10-10T22:00:00Z'; // 01:00 11 октября по Москве
    expect(humanDate(at, 'Europe/Moscow', now)).toBe('завтра 01:00');
    expect(humanDate(at, 'UTC', now)).toBe('сегодня 22:00');
  });

  it('даёт значение для datetime-local в поясе ресторана', () => {
    expect(toLocalInput(now, 'Europe/Moscow')).toBe('2026-10-10T23:30');
  });
});

describe('riskTier', () => {
  it('блокировка блюд всегда критична', () => {
    expect(riskTier('low', true)).toBe('critical');
    expect(riskTier('expiring', false)).toBe('attention');
    expect(riskTier('ok', false)).toBe('ok');
  });
});
