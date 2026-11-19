import React, { useState } from 'react';
import { signInWithEmailAndPassword, signInWithPopup, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { DEFAULT_PRIVACY_POLICY, verifyPasswordViaApi } from '../lib/seedData';
import type { EmployeeCredential } from '../types/app';
import { PWAInstallButton } from './PWAInstallButton';

interface LoginScreenProps {
  firebaseUser: User | null;
  needsProfileLink: boolean;
  onProfileLinked: () => void;
  onLogout: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  firebaseUser,
  needsProfileLink,
  onProfileLinked,
  onLogout,
}) => {
  const [tab, setTab] = useState<'google' | 'credentials'>(
    needsProfileLink ? 'credentials' : 'google'
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal masuk dengan Google.';
      if (msg.includes('popup-closed-by-user')) {
        setErrorMsg('Jendela login Google ditutup sebelum selesai.');
      } else {
        setErrorMsg(`Login Google gagal: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser || !password) {
      setErrorMsg('Masukkan username dan kata sandi pegawai.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      // Case 1: User already authenticated via Google and linking to an employee username/password
      if (firebaseUser) {
        const credPath = `employeeCredentials/${cleanUser}`;
        let credSnap;
        try {
          credSnap = await getDoc(doc(db, 'employeeCredentials', cleanUser));
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, credPath);
        }

        if (!credSnap || !credSnap.exists()) {
          setErrorMsg(
            `Username "${cleanUser}" belum terdaftar atau sudah ditautkan ke akun lain. Hubungi Direktur/Admin.`
          );
          setLoading(false);
          return;
        }

        const cred = credSnap.data() as EmployeeCredential;
        if (cred.linkedUid && cred.linkedUid !== firebaseUser.uid) {
          setErrorMsg('Akun pegawai ini sudah ditautkan ke perangkat/akun Google lain.');
          setLoading(false);
          return;
        }

        const isValid = await verifyPasswordViaApi(password, cred.passwordSalt, cred.passwordHash);
        if (!isValid) {
          setErrorMsg('Kata sandi salah. Periksa kembali atau minta reset sandi dari Admin.');
          setLoading(false);
          return;
        }

        // Link credential, employee record, and user profile
        await updateDoc(doc(db, 'employeeCredentials', cleanUser), {
          linkedUid: firebaseUser.uid,
          updatedAt: serverTimestamp(),
        });

        await updateDoc(doc(db, 'employees', cred.employeeId), {
          linkedUid: firebaseUser.uid,
          updatedAt: serverTimestamp(),
        });

        await setDoc(doc(db, 'users', firebaseUser.uid), {
          uid: firebaseUser.uid,
          email: firebaseUser.email || `${cleanUser}@reyrentcar.id`,
          displayName: firebaseUser.displayName || cleanUser,
          role: 'employee',
          employeeId: cred.employeeId,
          username: cleanUser,
          consentBiometric: false,
          consentLocation: false,
          updatedAt: serverTimestamp(),
        });

        onProfileLinked();
        return;
      }

      // Case 2: Direct Username + Password login (if Email/Password auth is enabled in Firebase Console)
      const mappedEmail = `${cleanUser}@reyrentcar.id`;
      try {
        await signInWithEmailAndPassword(auth, mappedEmail, password);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('operation-not-allowed') || msg.includes('admin-restricted-operation')) {
          setErrorMsg(
            'Untuk keamanan Firebase, silakan klik "Masuk dengan Google" terlebih dahulu lalu tautkan Username & Password pegawai Anda.'
          );
          setTab('google');
        } else if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
          setErrorMsg(
            'Username/kata sandi belum aktif di Firebase Email Auth atau salah. Gunakan "Masuk dengan Google" lalu tautkan akun pegawai Anda.'
          );
        } else {
          setErrorMsg(msg);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-[#F8F7F4] flex flex-col justify-between p-4 sm:p-8 relative overflow-hidden">
      {/* Subtle architectural radial glow */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[640px] rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #D4AF37 0%, transparent 70%)' }}
      />

      {/* Top utility bar */}
      <div className="relative z-10 mx-auto w-full max-w-5xl flex items-center justify-between gap-4">
        <div className="text-xs font-medium text-zinc-400">
          Zona Waktu Operasional: <span className="text-[#F6E08B] font-mono">WIB (Asia/Jakarta)</span>
        </div>
        <PWAInstallButton />
      </div>

      {/* Main Centered Login Grid */}
      <div className="relative z-10 mx-auto my-8 w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
        {/* Left Brand Showcase */}
        <div className="rounded-3xl border border-[#D4AF37]/25 bg-[#121216] p-6 sm:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            <div className="rounded-2xl overflow-hidden border border-[#D4AF37]/30 bg-[#0B0B0D] p-3">
              <img
                src="/assets/aistudio/logo_77714fbc.jpg"
                alt="Logo Resmi REY RENT CAR"
                referrerPolicy="no-referrer"
                className="w-full h-36 sm:h-44 object-contain rounded-xl"
              />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                REY RENT CAR
              </h1>
              <p className="text-xs sm:text-sm font-semibold tracking-wide text-[#D4AF37]">
                SMART ATTENDANCE – REALTIME EMPLOYEE MONITORING
              </p>
              <p className="text-sm text-zinc-400 leading-relaxed pt-1">
                Sistem manajemen kehadiran pegawai terintegrasi verifikasi wajah langsung, kunci koordinat GPS server WIB, pelacakan perjalanan dinas, dan laporan otomatis.
              </p>
            </div>
          </div>

          <div className="border-t border-zinc-800/80 pt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-[#18181D] p-3 border border-zinc-800">
              <div className="text-lg font-bold font-mono text-[#F6E08B]">9</div>
              <div className="text-[11px] text-zinc-400">Pegawai Aktif</div>
            </div>
            <div className="rounded-xl bg-[#18181D] p-3 border border-zinc-800">
              <div className="text-lg font-bold font-mono text-[#F6E08B]">GPS</div>
              <div className="text-[11px] text-zinc-400">Tracker Live</div>
            </div>
            <div className="rounded-xl bg-[#18181D] p-3 border border-zinc-800">
              <div className="text-lg font-bold font-mono text-[#F6E08B]">WIB</div>
              <div className="text-[11px] text-zinc-400">Waktu Server</div>
            </div>
          </div>
        </div>

        {/* Right Authentication Form */}
        <div className="rounded-3xl border border-zinc-800 bg-[#121216] p-6 sm:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white">
                {needsProfileLink ? 'Tautkan Akun Pegawai' : 'Masuk ke Sistem'}
              </h2>
              <p className="mt-1 text-xs text-zinc-400">
                {needsProfileLink
                  ? `Akun Google (${firebaseUser?.email}) berhasil terautentikasi. Masukkan Username & Kata Sandi pegawai untuk membuka portal Anda.`
                  : 'Pilih metode akses Direktur/Admin atau Pegawai REY RENT CAR.'}
              </p>
            </div>

            {!needsProfileLink && (
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#0B0B0D] p-1 border border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setTab('google');
                    setErrorMsg(null);
                  }}
                  className={`rounded-lg py-2.5 text-xs font-semibold transition cursor-pointer ${
                    tab === 'google'
                      ? 'bg-[#D4AF37] text-[#0B0B0D]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Akun Google (Direktur / Pegawai)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('credentials');
                    setErrorMsg(null);
                  }}
                  className={`rounded-lg py-2.5 text-xs font-semibold transition cursor-pointer ${
                    tab === 'credentials'
                      ? 'bg-[#D4AF37] text-[#0B0B0D]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Username & Password
                </button>
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {tab === 'google' && !needsProfileLink ? (
              <div className="space-y-4">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleGoogleLogin}
                  className="w-full flex items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] py-3.5 px-4 text-sm font-bold text-[#0B0B0D] shadow-lg hover:brightness-110 disabled:opacity-50 transition cursor-pointer min-h-[48px]"
                >
                  <LogIn className="w-4 h-4" />
                  <span>{loading ? 'Menghubungkan...' : 'Masuk dengan Google'}</span>
                </button>

                <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-4 space-y-2 text-xs text-zinc-300">
                  <div className="font-semibold text-[#F6E08B] flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Akses Terproteksi Firebase Authentication</span>
                  </div>
                  <p className="text-zinc-400 leading-relaxed">
                    Direktur/Admin masuk menggunakan akun Google terotorisasi. Pegawai dapat masuk dengan Google lalu menautkan username & kata sandi yang diberikan Admin.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCredentialSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-300">
                    Username Pegawai
                  </label>
                  <div className="relative">
                    <UserCheck className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Contoh: fahmi, rian, hendra"
                      autoComplete="username"
                      className="w-full rounded-xl border border-zinc-800 bg-[#18181D] pl-10 pr-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-300">
                    Kata Sandi
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Kata sandi awal: Rey@2026"
                      autoComplete="current-password"
                      className="w-full rounded-xl border border-zinc-800 bg-[#18181D] pl-10 pr-11 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4AF37] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1 cursor-pointer"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] py-3.5 px-4 text-sm font-bold text-[#0B0B0D] hover:brightness-110 disabled:opacity-50 transition cursor-pointer min-h-[48px]"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>
                    {loading
                      ? 'Memverifikasi...'
                      : needsProfileLink
                      ? 'Verifikasi & Tautkan Akun'
                      : 'Masuk dengan Username'}
                  </span>
                </button>

                {needsProfileLink && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full rounded-xl border border-zinc-800 py-2.5 text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-900 transition cursor-pointer"
                  >
                    Ganti Akun Google
                  </button>
                )}
              </form>
            )}
          </div>

          <div className="border-t border-zinc-800/80 pt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <button
              type="button"
              onClick={() => setShowPrivacy(true)}
              className="text-[#D4AF37] hover:underline cursor-pointer"
            >
              Kebijakan Privasi & Keamanan Data
            </button>
            <span>© {new Date().getFullYear()} REY RENT CAR</span>
          </div>
        </div>
      </div>

      {/* Privacy Policy Modal */}
      {showPrivacy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-[#D4AF37]/35 bg-[#121216] p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-[#F6E08B]">
              Kebijakan Privasi & Perlindungan Data REY RENT CAR
            </h3>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              {DEFAULT_PRIVACY_POLICY}
            </p>
            <div className="rounded-xl bg-[#18181D] p-3.5 text-xs text-zinc-400 space-y-1 border border-zinc-800">
              <p>• Verifikasi wajah diproses secara langsung (anti-galeri) dengan persetujuan pegawai.</p>
              <p>• Pelacakan perjalanan GPS bersifat transparan dan hanya aktif saat tombol Mulai Tracker ditekan.</p>
              <p>• Semua kata sandi dienkripsi dengan algoritma scrypt + salt acak.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowPrivacy(false)}
              className="w-full rounded-xl bg-[#D4AF37] py-2.5 text-sm font-bold text-[#0B0B0D] cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      <div className="relative z-10 text-center text-[11px] text-zinc-500">
        Didukung koneksi HTTPS terenkripsi, Cloud Firestore Security Rules, dan Google Maps Platform.
      </div>
    </div>
  );
};
