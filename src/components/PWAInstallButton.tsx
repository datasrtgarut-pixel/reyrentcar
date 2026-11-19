import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] px-3.5 py-2 text-xs font-semibold text-[#0B0B0D] shadow-sm hover:brightness-110 transition cursor-pointer whitespace-nowrap shrink-0 min-h-[40px]"
      >
        <Download className="w-4 h-4" />
        <span>{compact ? 'Pasang App' : 'Pasang Aplikasi Android'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#D4AF37]/40 bg-[#18181D] px-3 py-2 text-xs font-medium text-[#F6E08B] hover:bg-[#222229] transition cursor-pointer whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <Smartphone className="w-4 h-4" />
          <span>Pasang PWA</span>
        </button>

        {showGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-[#D4AF37]/30 bg-[#141418] p-6 text-[#F8F7F4] shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[#F6E08B]">Pasang REY RENT CAR di HP</h3>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-3 text-sm text-zinc-300 leading-relaxed">
                1. Ketuk tombol <strong>Bagikan (Share)</strong> di bilah browser.<br />
                2. Pilih <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.<br />
                3. Ketuk <strong>Tambah</strong> untuk menjalankan sebagai aplikasi Android/iOS.
              </p>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="mt-5 w-full rounded-xl bg-[#D4AF37] py-2.5 text-sm font-semibold text-[#0B0B0D] hover:brightness-110 transition"
              >
                Mengerti
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
