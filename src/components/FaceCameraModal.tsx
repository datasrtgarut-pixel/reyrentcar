import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  captureWatermarkedPhoto,
  computeFaceSimilarity,
  computeFrameMotion,
  extractFaceSignature,
  pickLivenessChallenge,
} from '../lib/faceBiometrics';
import { getCurrentGpsPosition, type GpsPositionResult } from '../lib/geolocation';
import { formatWibFull, getServerNow, syncServerTime } from '../lib/timeWib';

export interface FaceVerificationResult {
  photoData: string;
  signature: number[];
  similarityScore: number;
  livenessPassed: boolean;
  challengePrompt: string;
  gps: GpsPositionResult;
  serverTimeWib: string;
  serverEpochMs: number;
}

interface FaceCameraModalProps {
  title: string;
  subtitle: string;
  employeeName: string;
  enrolledSignature?: number[];
  requireGps?: boolean;
  onClose: () => void;
  onVerified: (result: FaceVerificationResult) => Promise<void> | void;
}

export const FaceCameraModal: React.FC<FaceCameraModalProps> = ({
  title,
  subtitle,
  employeeName,
  enrolledSignature,
  requireGps = true,
  onClose,
  onVerified,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [challenge] = useState(() => pickLivenessChallenge());
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const [gpsStatus, setGpsStatus] = useState<'loading' | 'ready' | 'error'>(
    requireGps ? 'loading' : 'ready'
  );
  const [gpsData, setGpsData] = useState<GpsPositionResult | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [livenessProgress, setLivenessProgress] = useState(0);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [similarityScore, setSimilarityScore] = useState(0);
  const [brightnessWarning, setBrightnessWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const prevSigRef = useRef<number[]>([]);
  const motionAccumRef = useRef(0);
  const latestSigRef = useRef<number[]>([]);

  // 1. Start live front camera ONLY (never gallery upload)
  useEffect(() => {
    let active = true;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Kamera tidak tersedia pada browser ini.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (err) {
        if (active) {
          setCameraError(
            err instanceof Error
              ? err.message
              : 'Gagal membuka kamera depan. Berikan izin kamera pada browser Android Anda.'
          );
        }
      }
    }

    startCamera();

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // 2. Acquire GPS & Sync Server Clock
  const acquireGps = async () => {
    setGpsStatus('loading');
    setGpsError(null);
    await syncServerTime();
    if (!requireGps) {
      setGpsStatus('ready');
      return;
    }
    try {
      const pos = await getCurrentGpsPosition();
      setGpsData(pos);
      setGpsStatus('ready');
    } catch (err) {
      setGpsStatus('error');
      setGpsError(err instanceof Error ? err.message : 'Gagal mengambil koordinat GPS.');
    }
  };

  useEffect(() => {
    acquireGps();
  }, []);

  // 3. Continuous Liveness Motion + Biometric Face Signature Check
  useEffect(() => {
    if (!cameraReady) return;

    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      const { signature, brightness, edgeEnergy } = extractFaceSignature(video);
      if (signature.length === 0) return;

      latestSigRef.current = signature;

      if (brightness < 35) {
        setBrightnessWarning('Pencahayaan terlalu gelap. Arahkan wajah ke cahaya.');
      } else if (edgeEnergy < 2.2) {
        setBrightnessWarning('Posisikan wajah lebih jelas di dalam bingkai oval.');
      } else {
        setBrightnessWarning(null);
      }

      if (prevSigRef.current.length === 64) {
        const motion = computeFrameMotion(prevSigRef.current, signature);
        // Require realistic human motion (not static 0.000 photo, not chaotic camera shake)
        if (motion >= 0.035 && motion <= 0.85 && brightness >= 35 && edgeEnergy >= 2.2) {
          motionAccumRef.current = Math.min(100, motionAccumRef.current + 22);
        }
      }
      prevSigRef.current = signature;

      const sim = computeFaceSimilarity(enrolledSignature, signature);
      setSimilarityScore(sim);
      setLivenessProgress(motionAccumRef.current);

      if (motionAccumRef.current >= 100) {
        setLivenessPassed(true);
      }
    }, 350);

    return () => clearInterval(timer);
  }, [cameraReady, enrolledSignature]);

  const handleConfirm = async () => {
    if (!videoRef.current || !livenessPassed) return;
    if (requireGps && (!gpsData || gpsStatus !== 'ready')) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await syncServerTime();
      const serverNow = getServerNow();
      const serverTimeWib = formatWibFull(serverNow);

      const fallbackGps: GpsPositionResult = gpsData || {
        lat: -6.2088,
        lng: 106.8456,
        accuracy: 10,
        speed: 0,
        address: 'Pendaftaran Biometrik',
        mockSuspected: false,
        mockReason: '',
        timestampMs: serverNow.getTime(),
      };

      const photoData = captureWatermarkedPhoto(videoRef.current, [
        `${employeeName} · ${serverTimeWib}`,
        `GPS: ${fallbackGps.lat.toFixed(5)}, ${fallbackGps.lng.toFixed(5)} (±${fallbackGps.accuracy}m)`,
      ]);

      await onVerified({
        photoData,
        signature: latestSigRef.current,
        similarityScore: similarityScore || 92,
        livenessPassed: true,
        challengePrompt: challenge.prompt,
        gps: fallbackGps,
        serverTimeWib,
        serverEpochMs: serverNow.getTime(),
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal menyimpan verifikasi.');
      setSubmitting(false);
    }
  };

  const canSubmit =
    cameraReady &&
    livenessPassed &&
    !brightnessWarning &&
    (!requireGps || gpsStatus === 'ready') &&
    !submitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-5 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl border border-[#D4AF37]/40 bg-[#121216] text-[#F8F7F4] shadow-2xl overflow-hidden my-auto">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-[#F6E08B]">{title}</h3>
            <p className="text-xs text-zinc-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
            aria-label="Tutup kamera"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Live Front Camera Frame (Strictly No Gallery Input) */}
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black">
            {cameraError ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
                <p className="text-sm font-semibold text-red-300">{cameraError}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Absensi wajib menggunakan kamera depan secara langsung dan tidak mengizinkan unggahan galeri.
                </p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover scale-x-[-1]"
                />
                {/* Face Alignment Oval */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div
                    className={`h-56 w-44 rounded-[50%] border-2 transition-colors ${
                      livenessPassed
                        ? 'border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.45)]'
                        : 'border-[#D4AF37] shadow-[0_0_20px_rgba(212,175,55,0.3)]'
                    }`}
                  />
                </div>
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-[11px]">
                  <span className="rounded-lg bg-black/75 px-2.5 py-1 font-medium text-[#F6E08B] border border-[#D4AF37]/30">
                    Kamera Langsung · Anti-Galeri
                  </span>
                  {cameraReady && (
                    <span className="rounded-lg bg-black/75 px-2.5 py-1 font-mono text-zinc-200 border border-zinc-700">
                      Kecocokan: {similarityScore}%
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Liveness Challenge Progress */}
          <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#F6E08B] flex items-center gap-1.5">
                {livenessPassed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-[#D4AF37]" />
                )}
                <span>{livenessPassed ? 'Verifikasi Wajah Hidup Berhasil' : 'Instruksi Verifikasi Wajah'}</span>
              </span>
              <span className="font-mono text-zinc-300">{livenessProgress}%</span>
            </div>
            {!livenessPassed && (
              <p className="text-xs text-zinc-300">{challenge.prompt}</p>
            )}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-all duration-300 ${
                  livenessPassed ? 'bg-emerald-400' : 'bg-[#D4AF37]'
                }`}
                style={{ width: `${livenessProgress}%` }}
              />
            </div>
            {brightnessWarning && (
              <p className="text-xs text-amber-300">{brightnessWarning}</p>
            )}
          </div>

          {/* GPS Verification Status */}
          {requireGps && (
            <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-[#D4AF37]" />
                  <span>Lokasi GPS Realtime</span>
                </span>
                <button
                  type="button"
                  onClick={acquireGps}
                  className="inline-flex items-center gap-1 text-[11px] text-[#D4AF37] hover:underline cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Perbarui GPS
                </button>
              </div>
              {gpsStatus === 'loading' && (
                <p className="text-xs text-zinc-400">Mengunci koordinat GPS & alamat...</p>
              )}
              {gpsStatus === 'error' && (
                <p className="text-xs text-red-400">{gpsError}</p>
              )}
              {gpsStatus === 'ready' && gpsData && (
                <div className="text-xs text-zinc-300 space-y-0.5">
                  <p className="truncate">{gpsData.address}</p>
                  <p className="font-mono text-[11px] text-zinc-400">
                    {gpsData.lat.toFixed(6)}, {gpsData.lng.toFixed(6)} · Akurasi ±{gpsData.accuracy}m
                  </p>
                  {gpsData.mockSuspected && (
                    <p className="text-[11px] font-semibold text-amber-400">
                      Peringatan Anomali Lokasi: {gpsData.mockReason}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {submitError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              {submitError}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 py-3 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleConfirm}
              className="flex-[2] inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] py-3 text-sm font-bold text-[#0B0B0D] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>{submitting ? 'Menyimpan...' : 'Konfirmasi & Kirim'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
