import React, { useState } from 'react';
import { Camera, MapPin, ShieldCheck } from 'lucide-react';
import { DEFAULT_PRIVACY_POLICY } from '../lib/seedData';

interface ConsentModalProps {
  employeeName: string;
  privacyText?: string;
  onAccept: () => Promise<void>;
  onLogout: () => void;
}

export const ConsentModal: React.FC<ConsentModalProps> = ({
  employeeName,
  privacyText,
  onAccept,
  onLogout,
}) => {
  const [biometricChecked, setBiometricChecked] = useState(true);
  const [locationChecked, setLocationChecked] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!biometricChecked || !locationChecked) return;
    setSaving(true);
    try {
      await onAccept();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-2xl border border-[#D4AF37]/40 bg-[#121216] p-6 text-[#F8F7F4] space-y-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37]">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#F6E08B]">
              Persetujuan Penggunaan Data Wajah & GPS
            </h2>
            <p className="text-xs text-zinc-400">Halo, {employeeName}</p>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
          {privacyText || DEFAULT_PRIVACY_POLICY}
        </p>

        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-[#18181D] p-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={biometricChecked}
              onChange={(e) => setBiometricChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#D4AF37]"
            />
            <div className="text-xs space-y-0.5">
              <div className="font-semibold text-zinc-100 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>Persetujuan Verifikasi Wajah</span>
              </div>
              <p className="text-zinc-400">
                Saya menyetujui pengambilan foto kamera depan secara langsung dan penyimpanan tanda tangan wajah untuk absensi masuk & pulang.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-[#18181D] p-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={locationChecked}
              onChange={(e) => setLocationChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#D4AF37]"
            />
            <div className="text-xs space-y-0.5">
              <div className="font-semibold text-zinc-100 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>Persetujuan Pelacakan GPS Transparan</span>
              </div>
              <p className="text-zinc-400">
                Saya menyetujui pencatatan koordinat GPS saat absensi dan saat saya mengaktifkan fitur Tracker Perjalanan selama bertugas.
              </p>
            </div>
          </label>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onLogout}
            className="flex-1 rounded-xl border border-zinc-800 py-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-900 cursor-pointer"
          >
            Keluar
          </button>
          <button
            type="button"
            disabled={!biometricChecked || !locationChecked || saving}
            onClick={handleConfirm}
            className="flex-[2] rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] py-3 text-sm font-bold text-[#0B0B0D] disabled:opacity-40 cursor-pointer"
          >
            {saving ? 'Menyimpan...' : 'Setuju & Lanjutkan'}
          </button>
        </div>
      </div>
    </div>
  );
};
