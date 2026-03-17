import { db }    from '../db';
import { redis } from '../redis';

export interface PriceInput {
  declared_weight_kg:  number;
  declared_length_cm:  number;
  declared_width_cm:   number;
  declared_height_cm:  number;
  category:            string;
  is_fragile:          boolean;
  origin_office_id:    string;
  dest_office_id:      string;
}

export interface PriceBreakdown {
  declared_weight_kg:   number;
  volumetric_weight_kg: number;
  billable_weight_kg:   number;
  zone_rate_per_kg:     number;
  weight_multiplier:    number;
  base_calc:            number;
  category_surcharge:   number;
  fragile_surcharge:    number;
  last_mile_fee:        number;
  office_surcharge:     number;
  subtotal:             number;
  surge_multiplier:     number;
  final_price:          number;
  currency:             'TZS';
  pricing_version_id:   string;
}

// ─── Calculate price for a parcel ──────────────────────────────────────────
export async function calculatePrice(input: PriceInput): Promise<PriceBreakdown> {

  // STEP 1 — Get active pricing version
  const cacheKey = 'pricing:active';
  let pricing: any;

  const cached = await redis.get(cacheKey);
  if (cached) {
    pricing = JSON.parse(cached);
  } else {
    const { rows: [version] } = await db.query(
      `SELECT pv.version_id,
              json_agg(DISTINCT pz.*) as zones,
              json_agg(DISTINCT wb.*) as brackets,
              json_agg(DISTINCT cs.*) as surcharges
       FROM pricing_versions pv
       LEFT JOIN pricing_zones pz ON pz.version_id = pv.version_id
       LEFT JOIN weight_brackets wb ON wb.version_id = pv.version_id
       LEFT JOIN category_surcharges cs ON cs.version_id = pv.version_id
       WHERE pv.status = 'ACTIVE'
       GROUP BY pv.version_id`
    );
    if (!version) throw new Error('No active pricing configuration found');
    pricing = version;
    await redis.setEx(cacheKey, 3600, JSON.stringify(pricing));
  }

  // STEP 2 — Get office regions
  const { rows: [offices] } = await db.query(
    `SELECT
       o1.region as origin_region,
       o1.local_surcharge as origin_surcharge,
       o2.region as dest_region,
       of2.last_mile_fee,
       of2.local_surcharge as dest_surcharge
     FROM offices o1
     JOIN offices o2 ON o2.office_id = $2
     LEFT JOIN office_fees of2 ON of2.office_id = $2
     WHERE o1.office_id = $1`,
    [input.origin_office_id, input.dest_office_id]
  );
  if (!offices) throw new Error('Origin or destination office not found');

  // STEP 3 — Billable weight
  const volumetric_kg = (input.declared_length_cm * input.declared_width_cm * input.declared_height_cm) / 5000;
  const billable_kg   = Math.max(input.declared_weight_kg, volumetric_kg);

  // STEP 4 — Zone rate
  const zone = pricing.zones?.find(
    (z: any) => z.origin_region === offices.origin_region && z.dest_region === offices.dest_region
  );
  if (!zone) throw new Error(`No pricing found for route ${offices.origin_region} → ${offices.dest_region}`);
  const zone_rate = zone.base_rate_per_kg;

  // STEP 5 — Weight bracket multiplier
  const bracket = pricing.brackets
    ?.sort((a: any, b: any) => a.from_kg - b.from_kg)
    ?.find((b: any) => billable_kg >= b.from_kg && billable_kg < b.to_kg)
    ?? pricing.brackets?.sort((a: any, b: any) => b.from_kg - a.from_kg)[0]; // last bracket for heavy parcels
  const weight_multiplier = bracket?.rate_multiplier ?? 1.0;

  // STEP 6 — Base calculation
  const base_calc = zone_rate * billable_kg * weight_multiplier;

  // STEP 7 — Category surcharge
  const categorySurcharge = pricing.surcharges?.find(
    (s: any) => s.category === input.category
  );
  const category_surcharge = categorySurcharge?.fixed_amount_tzs ?? 0;

  // STEP 8 — Fragile surcharge
  const fragile_surcharge = input.is_fragile ? 1500 : 0;

  // STEP 9 — Last mile fee and office surcharge
  const last_mile_fee    = offices.last_mile_fee ?? 1500;
  const office_surcharge = offices.dest_surcharge ?? 0;

  // STEP 10 — Subtotal and final (surge applied by ML — default 1.0)
  const subtotal         = base_calc + category_surcharge + fragile_surcharge + last_mile_fee + office_surcharge;
  const surge_multiplier = 1.0; // ML service overrides this at booking time
  const final_price      = Math.round(subtotal * surge_multiplier);

  return {
    declared_weight_kg:   input.declared_weight_kg,
    volumetric_weight_kg: Math.round(volumetric_kg * 100) / 100,
    billable_weight_kg:   Math.round(billable_kg * 100) / 100,
    zone_rate_per_kg:     zone_rate,
    weight_multiplier,
    base_calc:            Math.round(base_calc),
    category_surcharge,
    fragile_surcharge,
    last_mile_fee,
    office_surcharge,
    subtotal:             Math.round(subtotal),
    surge_multiplier,
    final_price,
    currency:             'TZS',
    pricing_version_id:   pricing.version_id,
  };
}
