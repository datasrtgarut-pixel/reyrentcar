import type { WorkSchedule } from '../types/app';

let serverOffsetMs = 0;
let lastSyncSuccess = false;

export async function syncServerTime(): Promise<{ synced: boolean; offsetMs: number }> {
  try {
    const t0 = Date.now();
    const res = await fetch('/api/server-time', { cache: 'no-store' });
    if (!res.ok) throw new Error('Server time unavailable');
    const data = (await res.json()) as { epochMs: number };
    const t1 = Date.now();
    const rtt = t1 - t0;
    const estimatedServerNow = data.epochMs + Math.round(rtt / 2);
    serverOffsetMs = estimatedServerNow - t1;
    lastSyncSuccess = true;
    return { synced: true, offsetMs: serverOffsetMs };
  } catch {
    return { synced: lastSyncSuccess, offsetMs: serverOffsetMs };
  }
}

export function getServerNow(): Date {
  return new Date(Date.now() + serverOffsetMs);
}

export function getDeviceClockSkewSeconds(): number {
  return Math.round(Math.abs(serverOffsetMs) / 1000);
}

export function formatWibDate(date: Date = getServerNow()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatWibMonthKey(date: Date = getServerNow()): string {
  return formatWibDate(date).slice(0, 7);
}

export function formatWibTime(date: Date = getServerNow()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatWibShortTime(date: Date = getServerNow()): string {
  return formatWibTime(date).slice(0, 5);
}

export function formatWibFull(date: Date = getServerNow()): string {
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date) + ' WIB'
  );
}

export function formatMinutesToDuration(totalMinutes?: number): string {
  if (totalMinutes === undefined || totalMinutes === null || totalMinutes < 0) return '-';
  const hrs = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  return `${hrs}j ${mins}m`;
}

export function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function getWibTimeMinutes(date: Date): number {
  const str = formatWibTime(date);
  return parseTimeToMinutes(str.slice(0, 5));
}

export function evaluateCheckIn(checkInDate: Date, schedule: WorkSchedule) {
  const checkInMin = getWibTimeMinutes(checkInDate);
  const startMin = parseTimeToMinutes(schedule.startTime);
  const diff = checkInMin - startMin;
  const isLate = diff > schedule.lateToleranceMinutes;
  const lateMinutes = diff > 0 ? diff : 0;
  return {
    isLate,
    lateMinutes: isLate ? lateMinutes : 0,
    status: isLate ? ('terlambat' as const) : ('belum_pulang' as const),
  };
}

export function evaluateCheckOut(
  checkInEpoch: number,
  checkOutEpoch: number,
  lateMinutes: number,
  schedule: WorkSchedule,
  overtimeApproved: boolean
) {
  const rawMinutes = Math.max(0, Math.round((checkOutEpoch - checkInEpoch) / 60000));
  const breakThresholdMins = schedule.breakThresholdHours * 60;
  const breakDeductedMinutes = rawMinutes >= breakThresholdMins ? schedule.breakMinutes : 0;
  const netWorkMinutes = Math.max(0, rawMinutes - breakDeductedMinutes);

  const checkOutDate = new Date(checkOutEpoch);
  const outMin = getWibTimeMinutes(checkOutDate);
  const endMin = parseTimeToMinutes(schedule.endTime);

  const earlyLeaveMinutes = outMin < endMin ? endMin - outMin : 0;
  const rawOvertime = outMin > endMin ? outMin - endMin : 0;
  const overtimeMinutes = rawOvertime >= schedule.overtimeMinMinutes ? rawOvertime : 0;

  let status: 'hadir' | 'terlambat' | 'pulang_cepat' | 'lembur' = 'hadir';
  if (earlyLeaveMinutes > 15) {
    status = 'pulang_cepat';
  } else if (overtimeMinutes > 0 && (!schedule.requireOvertimeApproval || overtimeApproved)) {
    status = 'lembur';
  } else if (lateMinutes > 0) {
    status = 'terlambat';
  }

  return {
    workMinutes: rawMinutes,
    netWorkMinutes,
    breakDeductedMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    status,
  };
}

export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}
