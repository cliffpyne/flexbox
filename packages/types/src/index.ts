export type ParcelStatus = 'pending' | 'confirmed' | 'pickup_assigned'

  | 'picked_up' | 'at_office' | 'in_transit'
  | 'out_for_delivery' | 'delivered' | 'failed_delivery' | 'returned';

export interface User {
  id: string;
  phone: string;
  fullName: string;
  email?: string;
  role: 'customer' | 'rider' | 'agent' | 'admin';
  photoUrl?: string;
  createdAt: string;
}

export interface Parcel {
  id: string;
  trackingNumber: string;
  status: ParcelStatus;
  senderId: string;
  receiverName: string;
  receiverPhone: string;
  originLat: number;  originLng: number;
  originAddress: string;
  destLat: number;    destLng: number;
  destAddress: string;
  weightKg: number;
  priceTSH: number;
  riderId?: string;
  paidAt?: string;
  createdAt: string;
}

export interface Rider {
  id: string;
  vehicleType: 'motorcycle' | 'bicycle' | 'car' | 'van';
  vehiclePlate: string;
  currentLat: number;
  currentLng: number;
  isOnline: boolean;
  rating: number;
  earningsTSH: number;
  territory: string;
}

export interface Agent {
  id: string;
  territory: string;
  commissionRate: number;
  totalParcelsToday: number;
  earningsTSH: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface LatLng { lat: number; lng: number; }
