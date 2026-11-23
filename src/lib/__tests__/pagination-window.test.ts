import { getPageWindow } from '@/lib/pagination-window';

describe('getPageWindow', () => {
  it('shows every page when there are only a few', () => {
    expect(getPageWindow(1, 1)).toEqual([1]);
    expect(getPageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageWindow(1, 7)).toEqual([1, 2, 3, 'gap', 7]);
  });

  it('keeps first, last and the pages around the current one', () => {
    expect(getPageWindow(50, 100)).toEqual([1, 'gap', 48, 49, 50, 51, 52, 'gap', 100]);
    expect(getPageWindow(1, 100)).toEqual([1, 2, 3, 'gap', 100]);
    expect(getPageWindow(100, 100)).toEqual([1, 'gap', 98, 99, 100]);
  });

  it('shows a single missing page instead of replacing it with a gap', () => {
    expect(getPageWindow(5, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(getPageWindow(6, 10)).toEqual([1, 'gap', 4, 5, 6, 7, 8, 9, 10]);
    expect(getPageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, 6, 'gap', 10]);
  });

  it('never renders more than a handful of items, even for 4,800 pages', () => {
    for (const current of [1, 2, 100, 2400, 4799, 4800]) {
      const items = getPageWindow(current, 4800);
      expect(items.length).toBeLessThanOrEqual(9);
      expect(items[0]).toBe(1);
      expect(items[items.length - 1]).toBe(4800);
      expect(items).toContain(current);
    }
  });

  it('handles empty or invalid totals', () => {
    expect(getPageWindow(1, 0)).toEqual([]);
    expect(getPageWindow(1, -3)).toEqual([]);
    expect(getPageWindow(1, Number.NaN)).toEqual([]);
  });
});
