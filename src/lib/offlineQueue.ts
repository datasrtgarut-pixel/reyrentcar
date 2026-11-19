import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface OfflineSyncItem {
  id: string;
  collectionName: 'locations' | 'trackingHistory' | 'attendance';
  docId: string;
  mode: 'set' | 'update';
  payload: Record<string, unknown>;
  createdAtIso: string;
}

const STORAGE_KEY = 'rey_rent_car_offline_queue_v1';

export function getOfflineQueue(): OfflineSyncItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineSync(item: OfflineSyncItem): void {
  const current = getOfflineQueue().filter((x) => x.id !== item.id);
  current.push(item);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current.slice(-50)));
  } catch {
    // Ignore storage quota overflow
  }
}

export async function flushOfflineQueue(): Promise<{ flushed: number; remaining: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { flushed: 0, remaining: getOfflineQueue().length };
  }

  const queue = getOfflineQueue();
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  const remaining: OfflineSyncItem[] = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      const ref = doc(db, item.collectionName, item.docId);
      const dataWithServerTs = {
        ...item.payload,
        updatedAt: serverTimestamp(),
      };
      if (item.mode === 'set') {
        const setPayload =
          item.collectionName === 'locations'
            ? dataWithServerTs
            : { ...dataWithServerTs, createdAt: serverTimestamp() };
        await setDoc(ref, setPayload, { merge: true });
      } else {
        await updateDoc(ref, dataWithServerTs);
      }
      flushed++;
    } catch {
      remaining.push(item);
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    // Ignore
  }

  return { flushed, remaining: remaining.length };
}
