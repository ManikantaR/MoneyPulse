import {
  formatCents,
  formatCentsCompact,
  formatDate,
  formatDateShort,
  formatPercent,
} from '@/lib/format';

describe('formatCents', () => {
  it('should format positive cents as dollars', () => {
    expect(formatCents(12345)).toBe('$123.45');
  });

  it('should format zero', () => {
    expect(formatCents(0)).toBe('$0.00');
  });

  it('should format negative cents', () => {
    expect(formatCents(-5000)).toBe('-$50.00');
  });

  it('should handle large amounts', () => {
    expect(formatCents(10000000)).toBe('$100,000.00');
  });
});

describe('formatCentsCompact', () => {
  it('should format small amounts normally', () => {
    expect(formatCentsCompact(5000)).toMatch(/\$50/);
  });

  it('should compact thousands', () => {
    const result = formatCentsCompact(150000);
    expect(result).toMatch(/\$1\.5K|\$1\.50K|\$2K/);
  });
});

describe('formatDate', () => {
  it('should format ISO date string for display', () => {
    expect(formatDate('2026-03-15')).toBe('Mar 15, 2026');
  });
});

describe('formatDateShort', () => {
  it('should format date as short m/d', () => {
    expect(formatDateShort('2026-03-15')).toBe('3/15');
  });
});

describe('formatPercent', () => {
  it('should format decimal as percentage', () => {
    expect(formatPercent(0.856)).toBe('85.6%');
  });

  it('should handle 0', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('should handle 1 (100%)', () => {
    expect(formatPercent(1)).toBe('100.0%');
  });
});
