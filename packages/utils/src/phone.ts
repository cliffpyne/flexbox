export const isTanzanianPhone = (p: string): boolean =>
  /^(\+255|0)[67]\d{8}$/.test(p);

export const normalizePhone = (p: string): string =>
  p.startsWith('0') ? `+255${p.slice(1)}` : p;
