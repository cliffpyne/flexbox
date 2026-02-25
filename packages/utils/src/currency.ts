export const formatTSH = (n: number): string =>
  new Intl.NumberFormat('sw-TZ').format(n) + ' TSH';

export const parseTSH = (s: string): number =>
  parseInt(s.replace(/[^0-9]/g, ""), 10) || 0;
