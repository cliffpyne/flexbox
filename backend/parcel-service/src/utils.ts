import { db } from './db';

// Generate booking reference: TZ-00441
export async function generateBookingReference(): Promise<string> {
  const { rows: [{ count }] } = await db.query('SELECT COUNT(*) FROM parcels');
  const seq = String(parseInt(count) + 1).padStart(5, '0');
  return `TZ-${seq}`;
}

// Calculate volumetric weight (industry standard divisor 5000)
export function calculateVolumetricWeight(l: number, w: number, h: number): number {
  return (l * w * h) / 5000;
}

// Billable weight = higher of actual vs volumetric
export function calculateBillableWeight(actualKg: number, l: number, w: number, h: number): number {
  const volumetric = calculateVolumetricWeight(l, w, h);
  return Math.max(actualKg, volumetric);
}

// Calculate variance percentage between declared and confirmed
export function calculateVariancePct(declared: number, confirmed: number): number {
  if (declared === 0) return 100;
  return Math.abs((confirmed - declared) / declared) * 100;
}

// Simple price calculator — will be replaced by full pricing engine
export function calculatePrice(
  billableKg: number,
  universe: string,
  routeCode: string,
  pricingOverrides?: any
): { min: number; max: number } {
  const base = universe === 'UPCOUNTRY' ? 8000 : 3000;
  const perKg = universe === 'UPCOUNTRY' ? 2000 : 800;
  const lastMileFee = routeCode.endsWith('D1') ? 2500 : 0;
  const price = base + (billableKg * perKg) + lastMileFee;
  return {
    min: Math.round(price * 0.9),
    max: Math.round(price * 1.1),
  };
}

// Deposit amount = 30% of min price
export function calculateDeposit(minPrice: number): number {
  return Math.round(minPrice * 0.3);
}