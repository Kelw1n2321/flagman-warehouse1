import { describe, expect, it } from 'vitest';
import { share } from './store';

describe('share', () => {
  it('возвращает прежний объект, если ответ не изменился', () => {
    const prev = { items: [{ id: 1, qty: 2 }], total: 2 };
    const next = JSON.parse(JSON.stringify(prev));
    expect(share(prev, next)).toBe(prev);
  });

  it('сохраняет ссылки на неизменившиеся элементы и заменяет изменившиеся', () => {
    const prev = [
      { id: 1, qty: 2 },
      { id: 2, qty: 5 },
    ];
    const next = [
      { id: 1, qty: 2 },
      { id: 2, qty: 4 },
    ];
    const out = share(prev, next);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).not.toBe(prev[1]);
    expect(out).toEqual(next);
  });

  it('учитывает добавленные и удалённые поля', () => {
    const prev: Record<string, number> = { a: 1, b: 2 };
    expect(share(prev, { a: 1 })).toEqual({ a: 1 });
    expect(share(prev, { a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2, c: 3 });
  });
});
