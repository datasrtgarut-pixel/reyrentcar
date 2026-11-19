import { getDeviceClockSkewSeconds, haversineDistanceKm } from './timeWib';

export interface GpsPositionResult {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number;
  address: string;
  mockSuspected: boolean;
  mockReason: string;
  timestampMs: number;
}

let lastGpsFix: { lat: number; lng: number; ts: number } | null = null;

export async function reverseGeocodeViaProxy(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    if (res.status === 429) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      return `Koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
    const data = (await res.json()) as { address?: string; quotaExceeded?: boolean };
    if (data.quotaExceeded) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
    return data.address || `Koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  } catch {
    return `Koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}

export function detectMockLocationHeuristics(
  lat: number,
  lng: number,
  accuracy: number,
  speedMps: number | null
): { mockSuspected: boolean; mockReason: string } {
  const reasons: string[] = [];

  if (accuracy === 0) {
    reasons.push('Akurasi GPS tepat 0 meter (indikasi injeksi lokasi)');
  } else if (accuracy > 2000) {
    reasons.push(`Akurasi sangat rendah (${Math.round(accuracy)} m)`);
  }

  const now = Date.now();
  if (lastGpsFix && now - lastGpsFix.ts > 2000 && now - lastGpsFix.ts < 300000) {
    const distKm = haversineDistanceKm(lastGpsFix.lat, lastGpsFix.lng, lat, lng);
    const hours = (now - lastGpsFix.ts) / 3600000;
    const calcKmh = hours > 0 ? distKm / hours : 0;
    if (distKm > 3 && calcKmh > 180) {
      reasons.push(`Perpindahan koordinat tidak wajar (${Math.round(calcKmh)} km/jam)`);
    }
  }

  if (speedMps !== null && speedMps * 3.6 > 200) {
    reasons.push(`Kecepatan GPS ekstrem (${Math.round(speedMps * 3.6)} km/jam)`);
  }

  const clockSkew = getDeviceClockSkewSeconds();
  if (clockSkew > 180) {
    reasons.push(`Selisih jam perangkat vs server ${clockSkew} detik`);
  }

  lastGpsFix = { lat, lng, ts: now };

  return {
    mockSuspected: reasons.length > 0,
    mockReason: reasons.join('; '),
  };
}

export function getCurrentGpsPosition(): Promise<GpsPositionResult> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Perangkat atau browser ini tidak mendukung layanan GPS.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy, speed } = pos.coords;
        const { mockSuspected, mockReason } = detectMockLocationHeuristics(
          latitude,
          longitude,
          accuracy,
          speed
        );
        const address = await reverseGeocodeViaProxy(latitude, longitude);
        resolve({
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy),
          speed: speed ? Math.round(speed * 3.6) : 0,
          address,
          mockSuspected,
          mockReason,
          timestampMs: pos.timestamp || Date.now(),
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('Izin GPS ditolak. Aktifkan izin lokasi pada browser/HP Android Anda.'));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(new Error('Sinyal GPS tidak tersedia. Pastikan GPS HP Anda aktif.'));
        } else {
          reject(new Error('Waktu tunggu GPS habis. Coba lagi di area terbuka.'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  });
}
