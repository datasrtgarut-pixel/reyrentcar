import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { AlertTriangle, LogOut, ShieldAlert } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { ConsentModal } from './components/ConsentModal';
import { EmployeePortal } from './components/EmployeePortal';
import { LoginScreen } from './components/LoginScreen';
import { OfflineIndicator } from './components/OfflineIndicator';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { DEFAULT_PRIVACY_POLICY, ensureAdminSeedData } from './lib/seedData';
import type { AdminSettings, Employee, UserProfile, WorkSchedule } from './types/app';

const DEFAULT_ADMIN_EMAIL = 'sobarihartono@gmail.com';

const FALLBACK_SCHEDULE: WorkSchedule = {
  id: 'default',
  name: 'Jadwal Operasional Standar',
  startTime: '08:00',
  endTime: '17:00',
  lateToleranceMinutes: 15,
  breakMinutes: 60,
  breakThresholdHours: 5,
  overtimeMinMinutes: 30,
  requireOvertimeApproval: true,
  timezone: 'Asia/Jakarta',
};

const FALLBACK_SETTINGS: AdminSettings = {
  id: 'default',
  companyName: 'REY RENT CAR',
  tagline: 'SMART ATTENDANCE – REALTIME EMPLOYEE MONITORING',
  timezone: 'Asia/Jakarta',
  privacyPolicyText: DEFAULT_PRIVACY_POLICY,
  dataRetentionDays: 365,
  allowMockLocation: false,
  requireConsent: true,
};

export default function App() {
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);

  const [resolvingRole, setResolvingRole] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [needsProfileLink, setNeedsProfileLink] = useState(false);
  const [previewEmployee, setPreviewEmployee] = useState<Employee | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [schedule, setSchedule] = useState<WorkSchedule>(FALLBACK_SCHEDULE);
  const [settings, setSettings] = useState<AdminSettings>(FALLBACK_SETTINGS);

  // Global listener for Google Maps Platform quota limit
  useEffect(() => {
    const handleQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setIsAdminUser(false);
        setUserProfile(null);
        setEmployee(null);
        setNeedsProfileLink(false);
        setPreviewEmployee(null);
      }
    });
    return () => unsub();
  }, []);

  // Resolve user role, seed admin data, and subscribe to shared schedule/settings
  useEffect(() => {
    if (!firebaseUser) return;

    let cancelled = false;
    let unsubSchedule: (() => void) | undefined;
    let unsubSettings: (() => void) | undefined;
    let unsubEmployee: (() => void) | undefined;

    const initSession = async () => {
      setResolvingRole(true);
      try {
        let adminFlag = firebaseUser.email === DEFAULT_ADMIN_EMAIL;
        if (!adminFlag) {
          const adminSnap = await getDoc(doc(db, 'admins', firebaseUser.uid));
          if (adminSnap.exists()) {
            adminFlag = true;
          }
        }

        if (cancelled) return;
        setIsAdminUser(adminFlag);

        if (adminFlag) {
          await ensureAdminSeedData(
            firebaseUser.uid,
            firebaseUser.email || DEFAULT_ADMIN_EMAIL,
            firebaseUser.displayName || 'Direktur REY RENT CAR'
          );
          if (cancelled) return;
          setNeedsProfileLink(false);
        } else {
          // Resolve linked employee for regular user
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userRef);
          let resolvedEmpId: string | undefined;
          let resolvedProfile: UserProfile | null = null;

          if (userSnap.exists()) {
            resolvedProfile = userSnap.data() as UserProfile;
            resolvedEmpId = resolvedProfile.employeeId;
          }

          if (!resolvedEmpId) {
            const byUidSnap = await getDocs(
              query(collection(db, 'employees'), where('linkedUid', '==', firebaseUser.uid))
            );
            if (!byUidSnap.empty) {
              const matchedEmp = byUidSnap.docs[0].data() as Employee;
              resolvedEmpId = matchedEmp.id;
              resolvedProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || `${matchedEmp.username}@reyrentcar.id`,
                displayName: firebaseUser.displayName || matchedEmp.fullName,
                role: 'employee',
                employeeId: matchedEmp.id,
                username: matchedEmp.username,
                consentBiometric: false,
                consentLocation: false,
              };
              await setDoc(userRef, {
                ...resolvedProfile,
                updatedAt: serverTimestamp(),
              });
            } else if (firebaseUser.email) {
              const byEmailSnap = await getDocs(
                query(collection(db, 'employees'), where('email', '==', firebaseUser.email))
              );
              if (!byEmailSnap.empty) {
                const matchedEmp = byEmailSnap.docs[0].data() as Employee;
                resolvedEmpId = matchedEmp.id;
                await updateDoc(doc(db, 'employees', matchedEmp.id), {
                  linkedUid: firebaseUser.uid,
                  updatedAt: serverTimestamp(),
                });
                resolvedProfile = {
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName || matchedEmp.fullName,
                  role: 'employee',
                  employeeId: matchedEmp.id,
                  username: matchedEmp.username,
                  consentBiometric: false,
                  consentLocation: false,
                };
                await setDoc(userRef, {
                  ...resolvedProfile,
                  updatedAt: serverTimestamp(),
                });
              }
            }
          }

          if (cancelled) return;

          if (!resolvedEmpId) {
            setUserProfile(null);
            setEmployee(null);
            setNeedsProfileLink(true);
            setResolvingRole(false);
            return;
          }

          setUserProfile(resolvedProfile);
          setNeedsProfileLink(false);

          unsubEmployee = onSnapshot(
            doc(db, 'employees', resolvedEmpId),
            (snap) => {
              if (snap.exists()) {
                setEmployee(snap.data() as Employee);
              }
            },
            (err) => handleFirestoreError(err, OperationType.GET, `employees/${resolvedEmpId}`)
          );
        }

        // Subscribe to WorkSchedule & AdminSettings for authenticated users
        unsubSchedule = onSnapshot(
          doc(db, 'workSchedules', 'default'),
          (snap) => {
            if (snap.exists()) {
              setSchedule(snap.data() as WorkSchedule);
            }
          },
          (err) => handleFirestoreError(err, OperationType.GET, 'workSchedules/default')
        );

        unsubSettings = onSnapshot(
          doc(db, 'adminSettings', 'default'),
          (snap) => {
            if (snap.exists()) {
              setSettings(snap.data() as AdminSettings);
            }
          },
          (err) => handleFirestoreError(err, OperationType.GET, 'adminSettings/default')
        );
      } catch (err) {
        console.error('Error resolving session:', err);
      } finally {
        if (!cancelled) setResolvingRole(false);
      }
    };

    initSession();

    return () => {
      cancelled = true;
      if (unsubSchedule) unsubSchedule();
      if (unsubSettings) unsubSettings();
      if (unsubEmployee) unsubEmployee();
    };
  }, [firebaseUser, reloadTick]);

  // Sync employee online/offline presence in locations/{employeeId} if document exists
  useEffect(() => {
    if (!firebaseUser || !employee || isAdminUser) return;

    const syncPresence = async (online: boolean) => {
      try {
        const locRef = doc(db, 'locations', employee.id);
        const snap = await getDoc(locRef);
        if (snap.exists()) {
          await updateDoc(locRef, {
            isOnline: online,
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-blocking
      }
    };

    const onOnline = () => syncPresence(true);
    const onOffline = () => syncPresence(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [firebaseUser, employee, isAdminUser]);

  const handleLogout = async () => {
    setPreviewEmployee(null);
    await signOut(auth);
  };

  const handleAcceptConsent = async () => {
    if (!firebaseUser || !userProfile) return;
    const nowIso = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        consentBiometric: true,
        consentLocation: true,
        consentAt: nowIso,
        updatedAt: serverTimestamp(),
      });
      setUserProfile({
        ...userProfile,
        consentBiometric: true,
        consentLocation: true,
        consentAt: nowIso,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
    }
  };

  const renderQuotaBanner = () =>
    quotaExceeded ? (
      <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
        <span>
          Google Maps Platform quota reached. If you are the app owner, visit{' '}
          <a
            href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-semibold text-amber-950 hover:text-amber-800"
          >
            maps developer site
          </a>{' '}
          for instructions to update your account.
        </span>
      </div>
    ) : null;

  if (!authReady || resolvingRole) {
    return (
      <>
        {renderQuotaBanner()}
        <div className="min-h-screen bg-[#0B0B0D] text-[#F8F7F4] flex flex-col items-center justify-center p-6 gap-4">
          <img
            src="/assets/aistudio/logo_77714fbc.jpg"
            alt="REY RENT CAR"
            referrerPolicy="no-referrer"
            className="h-20 w-28 rounded-2xl object-contain border border-[#D4AF37]/40 bg-black p-2"
          />
          <div className="h-8 w-8 rounded-full border-2 border-[#D4AF37] border-t-transparent animate-spin" />
          <p className="text-xs font-medium text-zinc-400 tracking-wide">
            Memuat Sistem REY RENT CAR...
          </p>
        </div>
        <OfflineIndicator />
      </>
    );
  }

  if (!firebaseUser || needsProfileLink) {
    return (
      <>
        {renderQuotaBanner()}
        <LoginScreen
          firebaseUser={firebaseUser}
          needsProfileLink={needsProfileLink}
          onProfileLinked={() => setReloadTick((n) => n + 1)}
          onLogout={handleLogout}
        />
        <OfflineIndicator />
      </>
    );
  }

  if (isAdminUser) {
    if (previewEmployee) {
      const previewProfile: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || DEFAULT_ADMIN_EMAIL,
        displayName: previewEmployee.fullName,
        role: 'employee',
        employeeId: previewEmployee.id,
        username: previewEmployee.username,
        consentBiometric: true,
        consentLocation: true,
      };
      return (
        <>
          {renderQuotaBanner()}
          <EmployeePortal
            uid={firebaseUser.uid}
            userProfile={previewProfile}
            employee={previewEmployee}
            schedule={schedule}
            settings={settings}
            onLogout={handleLogout}
            isAdminPreview
            onExitPreview={() => setPreviewEmployee(null)}
          />
          <OfflineIndicator />
        </>
      );
    }

    return (
      <>
        {renderQuotaBanner()}
        <AdminDashboard
          adminUid={firebaseUser.uid}
          adminEmail={firebaseUser.email || DEFAULT_ADMIN_EMAIL}
          adminName={firebaseUser.displayName || 'Direktur REY RENT CAR'}
          schedule={schedule}
          settings={settings}
          onLogout={handleLogout}
          onPreviewEmployee={(emp) => setPreviewEmployee(emp)}
        />
        <OfflineIndicator />
      </>
    );
  }

  if (!employee) {
    return (
      <>
        {renderQuotaBanner()}
        <div className="min-h-screen bg-[#0B0B0D] text-[#F8F7F4] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-[#121216] p-6 text-center space-y-4">
            <AlertTriangle className="w-10 h-10 text-[#D4AF37] mx-auto" />
            <h2 className="text-base font-bold text-white">Data Pegawai Tidak Ditemukan</h2>
            <p className="text-xs text-zinc-400">
              Akun Anda belum terhubung ke profil pegawai aktif. Silakan hubungi Direktur/Admin REY RENT CAR.
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-2.5 text-xs font-bold text-[#0B0B0D] cursor-pointer"
            >
              <LogOut className="w-4 h-4" /> Keluar
            </button>
          </div>
        </div>
        <OfflineIndicator />
      </>
    );
  }

  if (employee.status === 'inactive') {
    return (
      <>
        {renderQuotaBanner()}
        <div className="min-h-screen bg-[#0B0B0D] text-[#F8F7F4] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-red-500/40 bg-[#121216] p-6 text-center space-y-4">
            <ShieldAlert className="w-10 h-10 text-red-400 mx-auto" />
            <h2 className="text-base font-bold text-red-300">Akun Pegawai Nonaktif</h2>
            <p className="text-xs text-zinc-400">
              Status kepegawaian <strong>{employee.fullName}</strong> saat ini dinonaktifkan oleh Direktur/Admin.
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-5 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-900 cursor-pointer"
            >
              <LogOut className="w-4 h-4" /> Keluar
            </button>
          </div>
        </div>
        <OfflineIndicator />
      </>
    );
  }

  const requiresConsentModal =
    settings.requireConsent && (!userProfile?.consentBiometric || !userProfile?.consentLocation);

  return (
    <>
      {renderQuotaBanner()}
      {requiresConsentModal && (
        <ConsentModal
          employeeName={employee.fullName}
          privacyText={settings.privacyPolicyText}
          onAccept={handleAcceptConsent}
          onLogout={handleLogout}
        />
      )}
      {userProfile && (
        <EmployeePortal
          uid={firebaseUser.uid}
          userProfile={userProfile}
          employee={employee}
          schedule={schedule}
          settings={settings}
          onLogout={handleLogout}
        />
      )}
      <OfflineIndicator />
    </>
  );
}
