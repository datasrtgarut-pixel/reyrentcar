import React, { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { flushOfflineQueue, getOfflineQueue } from '../lib/offlineQueue';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(() => getOfflineQueue().length);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    const refreshCount = () => setPendingCount(getOfflineQueue().length);
    const interval = setInterval(refreshCount, 4000);

    if (isOnline && getOfflineQueue().length > 0) {
      flushOfflineQueue().then(({ flushed, remaining }) => {
        setPendingCount(remaining);
        if (flushed > 0) {
          setSyncMessage(`${flushed} data offline berhasil disinkronkan ke server.`);
          setTimeout(() => setSyncMessage(null), 5000);
        }
      });
    }

    return () => clearInterval(interval);
  }, [isOnline]);

  if (isOnline && !syncMessage && pendingCount === 0) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:bottom-6 z-50 flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-[#18181D]/95 px-4 py-2.5 text-xs font-medium text-amber-200 shadow-xl backdrop-blur-md">
      {!isOnline ? (
        <div className="flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Mode Offline — Data tersimpan lokal ({pendingCount} antrean) dan otomatis disinkronkan saat internet kembali.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-emerald-300">
          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
          <span>{syncMessage || `Menyinkronkan ${pendingCount} data tertunda...`}</span>
        </div>
      )}
    </div>
  );
};
