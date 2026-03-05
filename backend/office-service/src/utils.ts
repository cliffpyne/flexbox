import { db } from './db';

// Auto-generate office code: DSM-HUB-01, ARU-BRANCH-02 etc
export async function generateOfficeCode(region: string, officeType: string): Promise<string> {
  const regionCode = region
    .split(' ')
    .map(w => w.slice(0, 3).toUpperCase())
    .join('')
    .slice(0, 3);

  const typeCode = officeType.slice(0, 3).toUpperCase();

  const { rows } = await db.query(
    `SELECT COUNT(*) as count FROM offices WHERE region = $1 AND office_type = $2`,
    [region, officeType]
  );

  const seq = String(parseInt(rows[0].count) + 1).padStart(2, '0');
  return `${regionCode}-${typeCode}-${seq}`;
}

// Round GPS to 3 decimal places for Redis cache key
export function roundGPS(lat: number, lng: number) {
  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
  };
}