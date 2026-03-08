import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';

// TTL in seconds per level
export const TOKEN_TTL: Record<string, number> = {
  L1: 4 * 3600,          // 4 hours
  L2: 48 * 3600,         // 48 hours
  L3: 72 * 3600,         // 72 hours
  L4: 168 * 3600,        // 7 days
  L5: 24 * 3600,         // 24 hours
  L6: 15 * 60,           // 15 minutes — anti-replay
};

// Expected role per level
export const LEVEL_ROLE: Record<string, string> = {
  L1: 'RIDER',
  L2: 'OFFICE_WORKER',
  L3: 'OFFICE_WORKER',
  L4: 'OFFICE_WORKER',
  L5: 'RIDER',
  L6: 'RIDER',
};

// Route → first active level
export function getFirstLevel(routeCode: string): string {
  const A = routeCode.split('-')[0];
  return A === 'A1' ? 'L1' : 'L2';
}

// Sign token with RS256 private key
export function signToken(payload: object): string {
  const privateKey = process.env.TOKEN_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

// Verify token with RS256 public key
export function verifyTokenJWT(jwtString: string): any | null {
  try {
    const publicKey = process.env.TOKEN_PUBLIC_KEY!.replace(/\\n/g, '\n');
    return jwt.verify(jwtString, publicKey, { algorithms: ['RS256'] });
  } catch { return null; }
}

// Generate QR code as base64 PNG
export async function generateQRBase64(jwtString: string): Promise<string> {
  return QRCode.toDataURL(jwtString, { width: 300, margin: 2 });
}

// Route active levels map
export const ROUTE_ACTIVE_LEVELS: Record<string, string[]> = {
  'A1-B1-C1-D1': ['L1','L2','L3','L4','L5','L6'],
  'A1-B1-C1-D2': ['L1','L2','L3','L4','L6'],
  'A1-B1-C2-D1': ['L1','L2','L3','L4','L5','L6'],
  'A1-B1-C2-D2': ['L1','L2','L3','L4','L6'],
  'A1-B2-C1-D1': ['L1','L2','L3','L4','L5','L6'],
  'A1-B2-C1-D2': ['L1','L2','L3','L4','L6'],
  'A1-B2-C2-D1': ['L1','L2','L3','L4','L5','L6'],
  'A1-B2-C2-D2': ['L1','L2','L3','L4','L6'],
  'A2-B1-C1-D1': ['L2','L3','L4','L5','L6'],
  'A2-B1-C1-D2': ['L2','L3','L4','L6'],
  'A2-B2-C2-D2': ['L2','L3','L4','L6'],
  'A3-B1-C1-D1': ['L2','L3','L4','L5','L6'],
  'A3-B2-C2-D2': ['L2','L3','L4','L6'],
  'A1-B0-C0-D1': ['L1','L6'],
  'A1-BIR-C0-D1':['L1','L2','L5','L6'],
  'A1-BIR-C0-D2':['L1','L2','L6'],
  'A2-BIR-C0-D1':['L2','L5','L6'],
  'A2-BIR-C0-D2':['L2','L6'],
  'A3-B0-C0-D1': ['L6'],
  'A1-BSP-C0-D1':['L1','L2','L5','L6'],
  'A2-BSP-C0-D1':['L2','L5','L6'],
};