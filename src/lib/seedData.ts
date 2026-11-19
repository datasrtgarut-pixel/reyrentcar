import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

export const INITIAL_EMPLOYEES = [
  { id: 'EMP-001', employeeCode: 'RRC-001', fullName: 'Muhammad Fahmi', username: 'fahmi', phone: '0812-8801-0001', position: 'Koordinator Armada' },
  { id: 'EMP-002', employeeCode: 'RRC-002', fullName: 'Rian Gunawan', username: 'rian', phone: '0812-8801-0002', position: 'Driver Eksekutif' },
  { id: 'EMP-003', employeeCode: 'RRC-003', fullName: 'Hendra Setiawan Fahrazi', username: 'hendra', phone: '0812-8801-0003', position: 'Driver VIP' },
  { id: 'EMP-004', employeeCode: 'RRC-004', fullName: 'Hairil', username: 'hairil', phone: '0812-8801-0004', position: 'Driver Operasional' },
  { id: 'EMP-005', employeeCode: 'RRC-005', fullName: 'Ara Suhara', username: 'ara', phone: '0812-8801-0005', position: 'Staff Administrasi Armada' },
  { id: 'EMP-006', employeeCode: 'RRC-006', fullName: 'Didin Wahyudin', username: 'didin', phone: '0812-8801-0006', position: 'Driver Operasional' },
  { id: 'EMP-007', employeeCode: 'RRC-007', fullName: 'Hendi Mahmudah', username: 'hendi', phone: '0812-8801-0007', position: 'Teknisi & Perawatan Unit' },
  { id: 'EMP-008', employeeCode: 'RRC-008', fullName: 'Wily Fakhrul Fauji', username: 'wily', phone: '0812-8801-0008', position: 'Driver Bandara & Antar Kota' },
  { id: 'EMP-009', employeeCode: 'RRC-009', fullName: 'Miftah Fauzi', username: 'miftah', phone: '0812-8801-0009', position: 'Staff Logistik & Pengiriman' },
];

export const DEFAULT_PRIVACY_POLICY =
  'Kebijakan Privasi REY RENT CAR: Data biometrik wajah dan titik koordinat GPS dikumpulkan semata-mata untuk keperluan verifikasi kehadiran dan pelacakan perjalanan dinas resmi selama jam kerja berlangsung atas persetujuan pegawai. Foto absensi dan dokumen pengajuan izin disimpan secara terenkripsi dan tidak pernah dipublikasikan ke pihak eksternal. Pegawai berhak mengajukan penghapusan data pribadi kepada Direktur/Admin setelah masa kerja berakhir sesuai masa retensi perusahaan.';

export async function hashPasswordViaApi(password: string): Promise<{ hash: string; salt: string }> {
  const res = await fetch('/api/auth/hash-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    throw new Error('Gagal melakukan enkripsi kata sandi.');
  }
  return (await res.json()) as { hash: string; salt: string };
}

export async function verifyPasswordViaApi(
  password: string,
  salt: string,
  hash: string
): Promise<boolean> {
  const res = await fetch('/api/auth/verify-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, salt, hash }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { valid: boolean };
  return Boolean(data.valid);
}

export async function ensureAdminSeedData(adminUid: string, adminEmail: string, adminName: string) {
  try {
    // 1. Register admin doc
    const adminRef = doc(db, 'admins', adminUid);
    const adminSnap = await getDoc(adminRef);
    if (!adminSnap.exists()) {
      await setDoc(adminRef, {
        uid: adminUid,
        email: adminEmail,
        name: adminName || 'Direktur REY RENT CAR',
        role: 'director',
        createdAt: serverTimestamp(),
      });
    }

    // 2. Ensure default WorkSchedule
    const scheduleRef = doc(db, 'workSchedules', 'default');
    const scheduleSnap = await getDoc(scheduleRef);
    if (!scheduleSnap.exists()) {
      await setDoc(scheduleRef, {
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
        updatedAt: serverTimestamp(),
      });
    }

    // 3. Ensure default AdminSettings
    const settingsRef = doc(db, 'adminSettings', 'default');
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      await setDoc(settingsRef, {
        id: 'default',
        companyName: 'REY RENT CAR',
        tagline: 'SMART ATTENDANCE – REALTIME EMPLOYEE MONITORING',
        timezone: 'Asia/Jakarta',
        privacyPolicyText: DEFAULT_PRIVACY_POLICY,
        dataRetentionDays: 365,
        allowMockLocation: false,
        requireConsent: true,
        updatedAt: serverTimestamp(),
      });
    }

    // 4. Seed the 9 employees & hashed credentials idempotently
    for (const emp of INITIAL_EMPLOYEES) {
      const empRef = doc(db, 'employees', emp.id);
      const empSnap = await getDoc(empRef);
      if (!empSnap.exists()) {
        await setDoc(empRef, {
          id: emp.id,
          employeeCode: emp.employeeCode,
          fullName: emp.fullName,
          username: emp.username,
          email: '',
          phone: emp.phone,
          position: emp.position,
          status: 'active',
          photoUrl: '',
          faceEnrolled: false,
          faceSignature: [],
          linkedUid: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const credRef = doc(db, 'employeeCredentials', emp.username);
      const credSnap = await getDoc(credRef);
      if (!credSnap.exists()) {
        const { hash, salt } = await hashPasswordViaApi('Rey@2026');
        await setDoc(credRef, {
          username: emp.username,
          employeeId: emp.id,
          passwordHash: hash,
          passwordSalt: salt,
          linkedUid: '',
          mustChangePassword: true,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seed/initial');
  }
}
