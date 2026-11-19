import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Bell,
  Calendar,
  CalendarDays,
  Check,
  Clock,
  Database,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  Plus,
  Printer,
  Route,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { exportToExcel, exportToPdf, printReportView } from '../lib/exportReports';
import { hashPasswordViaApi } from '../lib/seedData';
import {
  formatMinutesToDuration,
  formatWibDate,
  formatWibFull,
  formatWibMonthKey,
  getServerNow,
  syncServerTime,
} from '../lib/timeWib';
import type {
  AdminSettings,
  AppNotification,
  AttendanceRecord,
  AuditLog,
  Employee,
  EmployeeLocation,
  LeaveRequest,
  LeaveType,
  MonthlyReport,
  TrackingTrip,
  WorkSchedule,
} from '../types/app';
import { AttendanceCalendar } from './AttendanceCalendar';
import { GoogleMapViewer, locationsToMarkers, MapLegendBadge, type MapMarkerItem } from './GoogleMapViewer';
import { ProductivityChart, type ChartDataPoint } from './ProductivityChart';
import { PWAInstallButton } from './PWAInstallButton';

export type AdminMenuTab =
  | 'dashboard'
  | 'employees'
  | 'attendance'
  | 'gps'
  | 'trips'
  | 'leaves'
  | 'report_daily'
  | 'report_weekly'
  | 'report_monthly'
  | 'schedule'
  | 'notifications'
  | 'settings';

interface AdminDashboardProps {
  adminUid: string;
  adminEmail: string;
  adminName: string;
  schedule: WorkSchedule;
  settings: AdminSettings;
  onLogout: () => void;
  onPreviewEmployee?: (emp: Employee) => void;
}

const LEAVE_LABELS: Record<LeaveType, string> = {
  izin_pribadi: 'Izin Pribadi',
  sakit: 'Sakit',
  cuti: 'Cuti',
  tidak_masuk: 'Tidak Masuk Kerja',
  keperluan_mendesak: 'Keperluan Mendesak',
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminUid,
  adminEmail,
  adminName,
  schedule,
  settings,
  onLogout,
  onPreviewEmployee,
}) => {
  const [activeTab, setActiveTab] = useState<AdminMenuTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceList, setAttendanceList] = useState<AttendanceRecord[]>([]);
  const [locations, setLocations] = useState<EmployeeLocation[]>([]);
  const [trips, setTrips] = useState<TrackingTrip[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [monthlyReports, setMonthlyReports] = useState<MonthlyReport[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [nowWib, setNowWib] = useState<Date>(() => getServerNow());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => formatWibDate(getServerNow()));
  const [selectedMonth, setSelectedMonth] = useState(() => formatWibMonthKey(getServerNow()));
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('all');

  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<TrackingTrip | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Employee CRUD Modal
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [empForm, setEmpForm] = useState({
    fullName: '',
    username: '',
    phone: '',
    position: '',
    email: '',
    status: 'active' as 'active' | 'inactive',
    password: '',
  });
  const [savingEmp, setSavingEmp] = useState(false);

  // Leave Review Modal
  const [reviewingLeave, setReviewingLeave] = useState<LeaveRequest | null>(null);
  const [adminNote, setAdminNote] = useState('');

  // Schedule & Settings Forms
  const [scheduleForm, setScheduleForm] = useState<WorkSchedule>(schedule);
  const [settingsForm, setSettingsForm] = useState<AdminSettings>(settings);

  useEffect(() => setScheduleForm(schedule), [schedule]);
  useEffect(() => setSettingsForm(settings), [settings]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 5000);
  };

  useEffect(() => {
    syncServerTime();
    const timer = setInterval(() => setNowWib(getServerNow()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Realtime Firestore listeners for Admin
  useEffect(() => {
    const unsubs = [
      onSnapshot(
        query(collection(db, 'employees'), orderBy('employeeCode', 'asc')),
        (snap) => setEmployees(snap.docs.map((d) => d.data() as Employee)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'employees')
      ),
      onSnapshot(
        query(collection(db, 'attendance'), orderBy('dateWib', 'desc')),
        (snap) => setAttendanceList(snap.docs.map((d) => d.data() as AttendanceRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'attendance')
      ),
      onSnapshot(
        collection(db, 'locations'),
        (snap) => setLocations(snap.docs.map((d) => d.data() as EmployeeLocation)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'locations')
      ),
      onSnapshot(
        query(collection(db, 'trackingHistory'), orderBy('createdAt', 'desc')),
        (snap) => setTrips(snap.docs.map((d) => d.data() as TrackingTrip)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'trackingHistory')
      ),
      onSnapshot(
        query(collection(db, 'leaveRequests'), orderBy('createdAt', 'desc')),
        (snap) => setLeaves(snap.docs.map((d) => d.data() as LeaveRequest)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'leaveRequests')
      ),
      onSnapshot(
        query(collection(db, 'notifications'), orderBy('createdAt', 'desc')),
        (snap) =>
          setNotifications(
            snap.docs
              .map((d) => d.data() as AppNotification)
              .filter((n) => n.targetRole === 'admin')
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      ),
      onSnapshot(
        query(collection(db, 'monthlyReports'), orderBy('createdAt', 'desc')),
        (snap) => setMonthlyReports(snap.docs.map((d) => d.data() as MonthlyReport)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'monthlyReports')
      ),
      onSnapshot(
        query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc')),
        (snap) => setAuditLogs(snap.docs.map((d) => d.data() as AuditLog)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  const writeAudit = async (action: string, targetCollection: string, targetId: string, details: string) => {
    const id = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'auditLogs', id), {
        id,
        actorUid: adminUid,
        actorEmail: adminEmail,
        actorRole: 'admin',
        action,
        targetCollection,
        targetId,
        details: details.slice(0, 390),
        timestampWib: formatWibFull(getServerNow()),
        createdAt: serverTimestamp(),
      });
    } catch {
      // ignore
    }
  };

  const todayWib = formatWibDate(nowWib);

  // Compute today's monitoring summary across all employees
  const monitoringRows = useMemo(() => {
    return employees.map((emp) => {
      const att = attendanceList.find((a) => a.employeeId === emp.id && a.dateWib === todayWib) || null;
      const loc = locations.find((l) => l.employeeId === emp.id) || null;
      const approvedLeave =
        leaves.find(
          (lv) =>
            lv.employeeId === emp.id &&
            lv.status === 'approved' &&
            lv.startDate <= todayWib &&
            lv.endDate >= todayWib
        ) || null;

      let statusLabel = 'Belum Absen';
      if (att) {
        if (att.checkOutTime) {
          statusLabel =
            att.status === 'terlambat'
              ? 'Terlambat (Pulang)'
              : att.status === 'lembur'
              ? 'Lembur'
              : att.status === 'pulang_cepat'
              ? 'Pulang Cepat'
              : 'Sudah Pulang';
        } else {
          statusLabel = att.status === 'terlambat' ? 'Terlambat (Bertugas)' : 'Hadir';
        }
      } else if (approvedLeave) {
        statusLabel =
          approvedLeave.type === 'sakit'
            ? 'Sakit'
            : approvedLeave.type === 'tidak_masuk'
            ? 'Tidak Masuk'
            : 'Izin';
      }

      let liveWorkMins = att?.netWorkMinutes ?? att?.workMinutes ?? 0;
      if (att?.checkInEpoch && !att.checkOutEpoch) {
        liveWorkMins = Math.max(0, Math.round((nowWib.getTime() - att.checkInEpoch) / 60000));
      }

      return {
        employee: emp,
        attendance: att,
        location: loc,
        approvedLeave,
        statusLabel,
        liveWorkMins,
      };
    });
  }, [employees, attendanceList, locations, leaves, todayWib, nowWib]);

  // 9 Required Dashboard KPI Cards
  const kpiStats = useMemo(() => {
    const activeEmps = employees.filter((e) => e.status === 'active');
    const total = activeEmps.length;
    const hadir = monitoringRows.filter((r) => r.attendance?.checkInTime).length;
    const belumPulang = monitoringRows.filter((r) => r.attendance?.checkInTime && !r.attendance?.checkOutTime).length;
    const sudahPulang = monitoringRows.filter((r) => r.attendance?.checkOutTime).length;
    const terlambat = monitoringRows.filter((r) => (r.attendance?.lateMinutes || 0) > 0).length;
    const izin = monitoringRows.filter(
      (r) => !r.attendance && r.approvedLeave && r.approvedLeave.type !== 'sakit' && r.approvedLeave.type !== 'tidak_masuk'
    ).length;
    const sakit = monitoringRows.filter((r) => !r.attendance && r.approvedLeave?.type === 'sakit').length;
    const tidakMasuk = monitoringRows.filter((r) => !r.attendance && r.approvedLeave?.type === 'tidak_masuk').length;
    const belumAbsen = Math.max(0, total - hadir - izin - sakit - tidakMasuk);
    const dalamPerjalanan = locations.filter((l) => l.isTracking).length;

    return {
      total,
      hadir,
      belumAbsen,
      terlambat,
      izin,
      sakit,
      tidakMasuk,
      dalamPerjalanan,
      sudahPulang,
      belumPulang,
    };
  }, [employees, monitoringRows, locations]);

  const filteredMonitoringRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return monitoringRows;
    return monitoringRows.filter(
      (r) =>
        r.employee.fullName.toLowerCase().includes(q) ||
        r.employee.username.toLowerCase().includes(q) ||
        r.employee.position.toLowerCase().includes(q)
    );
  }, [monitoringRows, searchQuery]);

  // 7-day productivity chart
  const weeklyChartData: ChartDataPoint[] = useMemo(() => {
    const pts: ChartDataPoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(nowWib.getTime() - i * 86400000);
      const dKey = formatWibDate(d);
      const dayAtt = attendanceList.filter((a) => a.dateWib === dKey);
      const terlambat = dayAtt.filter((a) => (a.lateMinutes || 0) > 0).length;
      const hadir = dayAtt.filter((a) => (a.lateMinutes || 0) === 0).length;
      const izin = leaves.filter(
        (lv) => lv.status === 'approved' && lv.startDate <= dKey && lv.endDate >= dKey
      ).length;
      pts.push({ label: dKey.slice(5), hadir, terlambat, izin });
    }
    return pts;
  }, [attendanceList, leaves, nowWib]);

  // --- EMPLOYEE CRUD HANDLERS ---
  const openAddEmployee = () => {
    setEditingEmp(null);
    setEmpForm({
      fullName: '',
      username: '',
      phone: '',
      position: 'Driver Operasional',
      email: '',
      status: 'active',
      password: '',
    });
    setEmpModalOpen(true);
  };

  const openEditEmployee = (emp: Employee) => {
    setEditingEmp(emp);
    setEmpForm({
      fullName: emp.fullName,
      username: emp.username,
      phone: emp.phone,
      position: emp.position,
      email: emp.email || '',
      status: emp.status,
      password: '',
    });
    setEmpModalOpen(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullName = empForm.fullName.trim();
    const username = empForm.username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (fullName.length < 2 || username.length < 2 || empForm.phone.trim().length < 6) {
      showToast('error', 'Lengkapi nama lengkap, username valid, dan nomor HP pegawai.');
      return;
    }

    setSavingEmp(true);
    try {
      if (editingEmp) {
        await updateDoc(doc(db, 'employees', editingEmp.id), {
          fullName,
          phone: empForm.phone.trim(),
          position: empForm.position.trim(),
          email: empForm.email.trim(),
          status: empForm.status,
          updatedAt: serverTimestamp(),
        });

        if (empForm.password.trim().length >= 4) {
          const { hash, salt } = await hashPasswordViaApi(empForm.password.trim());
          await setDoc(
            doc(db, 'employeeCredentials', editingEmp.username),
            {
              username: editingEmp.username,
              employeeId: editingEmp.id,
              passwordHash: hash,
              passwordSalt: salt,
              linkedUid: editingEmp.linkedUid || '',
              mustChangePassword: true,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        await writeAudit('Edit Data Pegawai', 'employees', editingEmp.id, `Perbarui ${fullName}`);
        showToast('success', `Data ${fullName} berhasil diperbarui.`);
      } else {
        const nextNum = employees.length + 1;
        const empId = `EMP-${String(nextNum).padStart(3, '0')}-${Date.now().toString().slice(-3)}`;
        const empCode = `RRC-${String(nextNum).padStart(3, '0')}`;
        const initialPass = empForm.password.trim() || 'Rey@2026';

        await setDoc(doc(db, 'employees', empId), {
          id: empId,
          employeeCode: empCode,
          fullName,
          username,
          email: empForm.email.trim(),
          phone: empForm.phone.trim(),
          position: empForm.position.trim(),
          status: empForm.status,
          photoUrl: '',
          faceEnrolled: false,
          faceSignature: [],
          linkedUid: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const { hash, salt } = await hashPasswordViaApi(initialPass);
        await setDoc(doc(db, 'employeeCredentials', username), {
          username,
          employeeId: empId,
          passwordHash: hash,
          passwordSalt: salt,
          linkedUid: '',
          mustChangePassword: true,
          updatedAt: serverTimestamp(),
        });

        await writeAudit('Tambah Pegawai Baru', 'employees', empId, `${fullName} (@${username})`);
        showToast('success', `Pegawai baru ${fullName} ditambahkan.`);
      }
      setEmpModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'employees');
    } finally {
      setSavingEmp(false);
    }
  };

  const handleDeleteEmployee = async (emp: Employee) => {
    try {
      await deleteDoc(doc(db, 'employees', emp.id));
      await deleteDoc(doc(db, 'employeeCredentials', emp.username));
      await writeAudit('Hapus Pegawai', 'employees', emp.id, `Menghapus ${emp.fullName}`);
      showToast('success', `Data pegawai ${emp.fullName} dihapus.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `employees/${emp.id}`);
    }
  };

  // --- LEAVE APPROVAL ---
  const handleReviewLeave = async (decision: 'approved' | 'rejected') => {
    if (!reviewingLeave) return;
    try {
      const reviewedAt = formatWibFull(getServerNow());
      await updateDoc(doc(db, 'leaveRequests', reviewingLeave.id), {
        status: decision,
        adminNote: adminNote.trim(),
        reviewedBy: adminName,
        reviewedAt,
        updatedAt: serverTimestamp(),
      });

      const notifId = `notif-${Date.now()}`;
      await setDoc(doc(db, 'notifications', notifId), {
        id: notifId,
        targetRole: 'employee',
        targetEmployeeId: reviewingLeave.employeeId,
        uid: reviewingLeave.uid,
        category: 'leave',
        title: decision === 'approved' ? 'Pengajuan Disetujui' : 'Pengajuan Ditolak',
        message: `Pengajuan ${LEAVE_LABELS[reviewingLeave.type]} (${reviewingLeave.startDate}) ${
          decision === 'approved' ? 'DISETUJUI' : 'DITOLAK'
        }${adminNote.trim() ? `. Catatan: ${adminNote.trim()}` : ''}`,
        isRead: false,
        createdAtWib: reviewedAt,
        createdAt: serverTimestamp(),
      });

      await writeAudit(
        decision === 'approved' ? 'Setujui Izin/Sakit' : 'Tolak Izin/Sakit',
        'leaveRequests',
        reviewingLeave.id,
        `${reviewingLeave.employeeName} (${decision})`
      );

      setReviewingLeave(null);
      setAdminNote('');
      showToast('success', `Pengajuan ${decision === 'approved' ? 'disetujui' : 'ditolak'}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `leaveRequests/${reviewingLeave.id}`);
    }
  };

  // --- ATTENDANCE OVERRIDE (OVERTIME / RE-CLOCKIN) ---
  const handleApproveOvertime = async (att: AttendanceRecord) => {
    try {
      await updateDoc(doc(db, 'attendance', att.id), {
        overtimeApproved: true,
        status: (att.overtimeMinutes || 0) > 0 ? 'lembur' : att.status,
        updatedAt: serverTimestamp(),
      });
      await writeAudit('Setujui Lembur', 'attendance', att.id, `${att.employeeName} (${att.dateWib})`);
      showToast('success', `Lembur ${att.employeeName} disetujui.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `attendance/${att.id}`);
    }
  };

  const handleAllowReClockIn = async (att: AttendanceRecord) => {
    try {
      await updateDoc(doc(db, 'attendance', att.id), {
        reClockInApproved: true,
        updatedAt: serverTimestamp(),
      });
      await writeAudit('Izinkan Absen Ulang', 'attendance', att.id, `${att.employeeName} (${att.dateWib})`);
      showToast('success', `${att.employeeName} diizinkan melakukan absensi ulang hari ini.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `attendance/${att.id}`);
    }
  };

  // --- REPORTS COMPUTATION & EXPORT ---
  const filteredAttendance = useMemo(() => {
    return attendanceList.filter((a) => {
      if (filterEmployeeId !== 'all' && a.employeeId !== filterEmployeeId) return false;
      if (activeTab === 'report_daily' && a.dateWib !== selectedDate) return false;
      if (activeTab === 'report_monthly' && !a.dateWib.startsWith(selectedMonth)) return false;
      if (activeTab === 'report_weekly') {
        const refMs = new Date(`${selectedDate}T00:00:00+07:00`).getTime();
        const attMs = new Date(`${a.dateWib}T00:00:00+07:00`).getTime();
        const diffDays = (refMs - attMs) / 86400000;
        if (diffDays < 0 || diffDays > 6) return false;
      }
      return true;
    });
  }, [attendanceList, filterEmployeeId, activeTab, selectedDate, selectedMonth]);

  const weeklySummaryRows = useMemo(() => {
    const targetEmps =
      filterEmployeeId === 'all' ? employees : employees.filter((e) => e.id === filterEmployeeId);
    const refMs = new Date(`${selectedDate}T00:00:00+07:00`).getTime();

    return targetEmps.map((emp) => {
      const empAtts = attendanceList.filter((a) => {
        if (a.employeeId !== emp.id) return false;
        const attMs = new Date(`${a.dateWib}T00:00:00+07:00`).getTime();
        const diff = (refMs - attMs) / 86400000;
        return diff >= 0 && diff <= 6;
      });
      const empLeaves = leaves.filter(
        (lv) => lv.employeeId === emp.id && lv.status === 'approved'
      );
      const totalMins = empAtts.reduce((s, a) => s + (a.netWorkMinutes ?? a.workMinutes ?? 0), 0);
      const lateCount = empAtts.filter((a) => (a.lateMinutes || 0) > 0).length;

      return {
        employee: emp,
        daysWorked: empAtts.length,
        totalHours: Math.round((totalMins / 60) * 10) / 10,
        lateCount,
        leaveCount: empLeaves.length,
      };
    });
  }, [employees, attendanceList, leaves, filterEmployeeId, selectedDate]);

  const monthlySummaryRows = useMemo(() => {
    const targetEmps =
      filterEmployeeId === 'all' ? employees : employees.filter((e) => e.id === filterEmployeeId);
    const workingDaysTarget = 22;

    return targetEmps.map((emp) => {
      const empAtts = attendanceList.filter(
        (a) => a.employeeId === emp.id && a.dateWib.startsWith(selectedMonth)
      );
      const empLeaves = leaves.filter(
        (lv) =>
          lv.employeeId === emp.id &&
          lv.status === 'approved' &&
          lv.startDate.startsWith(selectedMonth)
      );
      const totalMins = empAtts.reduce((s, a) => s + (a.netWorkMinutes ?? a.workMinutes ?? 0), 0);
      const lateCount = empAtts.filter((a) => (a.lateMinutes || 0) > 0).length;
      const pct = Math.min(100, Math.round((empAtts.length / workingDaysTarget) * 100));
      const absentDays = Math.max(0, workingDaysTarget - empAtts.length - empLeaves.length);

      return {
        employee: emp,
        daysWorked: empAtts.length,
        attendanceRate: pct,
        totalHours: Math.round((totalMins / 60) * 10) / 10,
        lateCount,
        leaveCount: empLeaves.length,
        absentDays,
      };
    });
  }, [employees, attendanceList, leaves, filterEmployeeId, selectedMonth]);

  const handleSaveMonthlySnapshot = async () => {
    const repId = `rep-${selectedMonth}`;
    const avgRate =
      monthlySummaryRows.length > 0
        ? Math.round(
            monthlySummaryRows.reduce((s, r) => s + r.attendanceRate, 0) / monthlySummaryRows.length
          )
        : 0;
    const totalHours = Math.round(
      monthlySummaryRows.reduce((s, r) => s + r.totalHours, 0) * 10
    ) / 10;

    try {
      await setDoc(doc(db, 'monthlyReports', repId), {
        id: repId,
        monthKey: selectedMonth,
        generatedBy: adminName,
        totalEmployees: employees.length,
        attendanceRate: avgRate,
        totalHours,
        summaryText: `Rekap ${selectedMonth}: ${employees.length} pegawai, rata-rata kehadiran ${avgRate}%, total ${totalHours} jam kerja.`,
        createdAt: serverTimestamp(),
      });
      await writeAudit('Simpan Laporan Bulanan', 'monthlyReports', repId, `Bulan ${selectedMonth}`);
      showToast('success', `Arsip laporan bulanan ${selectedMonth} tersimpan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `monthlyReports/${repId}`);
    }
  };

  const handleExportBackupJson = () => {
    const backup = {
      exportedAtWib: formatWibFull(getServerNow()),
      company: 'REY RENT CAR',
      employees,
      attendance: attendanceList,
      trackingHistory: trips,
      leaveRequests: leaves,
      workSchedule: schedule,
      settings,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rey-rent-car-backup-${formatWibDate(getServerNow())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    writeAudit('Backup Data Sistem', 'adminSettings', 'backup', 'Ekspor JSON lengkap');
    showToast('success', 'File backup JSON berhasil diunduh.');
  };

  const unreadNotifCount = notifications.filter((n) => !n.isRead).length;

  const markAllNotificationsRead = async () => {
    for (const n of notifications.filter((x) => !x.isRead)) {
      await updateDoc(doc(db, 'notifications', n.id), { isRead: true });
    }
  };

  const navItems: Array<{ id: AdminMenuTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'dashboard', label: 'Dashboard Utama', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'employees', label: 'Data Pegawai', icon: <Users className="w-4 h-4" /> },
    { id: 'attendance', label: 'Monitoring Absensi', icon: <UserCheck className="w-4 h-4" /> },
    { id: 'gps', label: 'Monitoring GPS', icon: <MapPin className="w-4 h-4" /> },
    { id: 'trips', label: 'Tracker Perjalanan', icon: <Route className="w-4 h-4" /> },
    {
      id: 'leaves',
      label: 'Pengajuan Izin/Sakit',
      icon: <FileText className="w-4 h-4" />,
      badge: leaves.filter((l) => l.status === 'pending').length,
    },
    { id: 'report_daily', label: 'Laporan Harian', icon: <Calendar className="w-4 h-4" /> },
    { id: 'report_weekly', label: 'Laporan Mingguan', icon: <CalendarDays className="w-4 h-4" /> },
    { id: 'report_monthly', label: 'Laporan Bulanan', icon: <FileSpreadsheet className="w-4 h-4" /> },
    { id: 'schedule', label: 'Pengaturan Jam Kerja', icon: <Clock className="w-4 h-4" /> },
    { id: 'notifications', label: 'Notifikasi', icon: <Bell className="w-4 h-4" />, badge: unreadNotifCount },
    { id: 'settings', label: 'Pengaturan Sistem', icon: <Settings className="w-4 h-4" /> },
  ];

  const selectedTripMarkers: MapMarkerItem[] = useMemo(() => {
    if (!selectedTrip) return [];
    const list: MapMarkerItem[] = [
      {
        id: 'st',
        title: `Titik Awal · ${selectedTrip.startTimeWib}`,
        subtitle: selectedTrip.employeeName,
        lat: selectedTrip.startLat,
        lng: selectedTrip.startLng,
        address: selectedTrip.startAddress,
        badgeType: 'start',
      },
    ];
    if (selectedTrip.endLat && selectedTrip.endLng) {
      list.push({
        id: 'ed',
        title: `Akhir · ${selectedTrip.endTimeWib || ''}`,
        subtitle: `${selectedTrip.distanceKm} km`,
        lat: selectedTrip.endLat,
        lng: selectedTrip.endLng,
        address: selectedTrip.endAddress,
        badgeType: 'end',
      });
    }
    return list;
  }, [selectedTrip]);

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-[#F8F7F4] flex flex-col lg:flex-row">
      {/* Admin Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-zinc-800/80 bg-[#101014] p-4 justify-between overflow-y-auto">
        <div className="space-y-5">
          <div className="flex items-center gap-3 px-1">
            <img
              src="/assets/aistudio/logo_77714fbc.jpg"
              alt="REY RENT CAR"
              referrerPolicy="no-referrer"
              className="h-10 w-14 rounded-lg object-cover border border-[#D4AF37]/40 bg-black"
            />
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-[#F6E08B] truncate">REY RENT CAR</div>
              <div className="text-[11px] text-zinc-400 truncate">Direktur & Admin</div>
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition cursor-pointer ${
                  activeTab === item.id
                    ? 'bg-[#D4AF37] text-[#0B0B0D]'
                    : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                      activeTab === item.id
                        ? 'bg-[#0B0B0D] text-[#F6E08B]'
                        : 'bg-[#D4AF37]/20 text-[#F6E08B]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="pt-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-800 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-red-500/10 hover:text-red-300 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        {/* Top Bar */}
        <header className="no-print sticky top-0 z-30 border-b border-zinc-800/80 bg-[#0B0B0D]/90 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden rounded-xl border border-zinc-800 bg-[#141418] p-2 text-zinc-200 cursor-pointer"
              aria-label="Menu Admin"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-white truncate">
                {navItems.find((n) => n.id === activeTab)?.label}
              </h1>
              <div className="text-[11px] font-mono text-[#D4AF37] truncate">
                {formatWibFull(nowWib)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('notifications')}
              className="relative rounded-xl border border-zinc-800 bg-[#141418] p-2.5 text-zinc-200 hover:border-[#D4AF37]/50 cursor-pointer"
              aria-label="Pusat Notifikasi"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#D4AF37] text-[#0B0B0D] text-[10px] font-bold flex items-center justify-center">
                  {unreadNotifCount}
                </span>
              )}
            </button>
            <PWAInstallButton compact />
          </div>
        </header>

        {toast && (
          <div className="no-print px-4 sm:px-6 pt-4">
            <div
              className={`rounded-xl border p-3.5 text-xs font-medium flex items-center justify-between gap-3 ${
                toast.type === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/40 bg-red-500/10 text-red-200'
              }`}
            >
              <span>{toast.text}</span>
              <button type="button" onClick={() => setToast(null)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-6">
          {/* 1. DASHBOARD UTAMA */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* 9 Required KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { label: 'Total Pegawai', val: kpiStats.total, accent: 'text-[#F6E08B]' },
                  { label: 'Hadir Hari Ini', val: kpiStats.hadir, accent: 'text-emerald-400' },
                  { label: 'Belum Absen', val: kpiStats.belumAbsen, accent: 'text-zinc-300' },
                  { label: 'Terlambat', val: kpiStats.terlambat, accent: 'text-amber-400' },
                  { label: 'Izin', val: kpiStats.izin, accent: 'text-sky-400' },
                  { label: 'Sakit', val: kpiStats.sakit, accent: 'text-indigo-400' },
                  { label: 'Tidak Masuk', val: kpiStats.tidakMasuk, accent: 'text-red-400' },
                  { label: 'Dalam Perjalanan', val: kpiStats.dalamPerjalanan, accent: 'text-[#D4AF37]' },
                  { label: 'Sudah Absen Pulang', val: kpiStats.sudahPulang, accent: 'text-emerald-300' },
                  { label: 'Belum Absen Pulang', val: kpiStats.belumPulang, accent: 'text-amber-300' },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="rounded-2xl border border-zinc-800/90 bg-[#121216] p-4 flex flex-col justify-between"
                  >
                    <span className="text-[11px] font-medium text-zinc-400">{c.label}</span>
                    <span className={`mt-2 text-2xl font-extrabold font-mono ${c.accent}`}>
                      {c.val}
                    </span>
                  </div>
                ))}
              </div>

              {/* Monitoring Table of all 9 Employees */}
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-[#F6E08B]">
                      Tabel Monitoring Pegawai Hari Ini
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Klik nama pegawai untuk melihat foto absensi, koordinat peta, riwayat perjalanan, dan izin.
                    </p>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari nama pegawai..."
                      className="w-full rounded-xl border border-zinc-800 bg-[#18181D] pl-9 pr-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-800 text-zinc-400">
                      <tr>
                        <th className="py-2.5 pr-4">Nama Pegawai</th>
                        <th className="py-2.5 pr-4">Jabatan</th>
                        <th className="py-2.5 pr-4">Jam Masuk</th>
                        <th className="py-2.5 pr-4">Jam Pulang</th>
                        <th className="py-2.5 pr-4">Total Kerja</th>
                        <th className="py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {filteredMonitoringRows.map((row) => (
                        <tr
                          key={row.employee.id}
                          onClick={() => setDetailEmployee(row.employee)}
                          className="hover:bg-[#18181D] transition cursor-pointer"
                        >
                          <td className="py-3 pr-4 font-semibold text-[#F6E08B] hover:underline">
                            {row.employee.fullName}
                          </td>
                          <td className="py-3 pr-4 text-zinc-400">{row.employee.position}</td>
                          <td className="py-3 pr-4 font-mono text-white">
                            {row.attendance?.checkInTime?.slice(0, 5) || '-'}
                          </td>
                          <td className="py-3 pr-4 font-mono text-white">
                            {row.attendance?.checkOutTime?.slice(0, 5) ||
                              (row.attendance?.checkInTime ? 'Belum Pulang' : '-')}
                          </td>
                          <td className="py-3 pr-4 font-mono text-zinc-200">
                            {row.attendance ? formatMinutesToDuration(row.liveWorkMins) : '-'}
                          </td>
                          <td className="py-3 font-semibold text-zinc-200">
                            {row.statusLabel}
                            {row.location?.isTracking ? ' · Dalam Perjalanan' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Charts & Live Map */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <ProductivityChart
                  title="Grafik Produktivitas Kehadiran (7 Hari Terakhir)"
                  subtitle="Perbandingan hadir tepat waktu, terlambat, dan izin/sakit"
                  data={weeklyChartData}
                />
                <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#F6E08B]">Peta Lokasi Pegawai Realtime</h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('gps')}
                      className="text-xs text-[#D4AF37] hover:underline cursor-pointer"
                    >
                      Buka Layar Penuh
                    </button>
                  </div>
                  <GoogleMapViewer markers={locationsToMarkers(locations)} heightClass="h-[230px]" />
                </div>
              </div>
            </div>
          )}

          {/* 2. DATA PEGAWAI */}
          {activeTab === 'employees' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nama, username, jabatan..."
                    className="w-full rounded-xl border border-zinc-800 bg-[#121216] pl-9 pr-4 py-2.5 text-xs text-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={openAddEmployee}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] px-4 py-2.5 text-xs font-bold text-[#0B0B0D] cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tambah Pegawai</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {employees
                  .filter((e) => {
                    const q = searchQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      e.fullName.toLowerCase().includes(q) ||
                      e.username.toLowerCase().includes(q) ||
                      e.position.toLowerCase().includes(q)
                    );
                  })
                  .map((emp) => (
                    <div
                      key={emp.id}
                      className="rounded-2xl border border-zinc-800 bg-[#121216] p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {emp.photoUrl ? (
                            <img
                              src={emp.photoUrl}
                              alt={emp.fullName}
                              className="h-12 w-12 rounded-xl object-cover border border-[#D4AF37]/40 shrink-0"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-xl bg-[#18181D] border border-zinc-700 flex items-center justify-center font-bold text-[#D4AF37] shrink-0">
                              {emp.fullName.charAt(0)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-white truncate">{emp.fullName}</div>
                            <div className="text-[11px] text-[#D4AF37] font-mono">
                              {emp.employeeCode} · @{emp.username}
                            </div>
                            <div className="text-[11px] text-zinc-400 truncate">{emp.position}</div>
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-bold uppercase ${
                            emp.status === 'active' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {emp.status === 'active' ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </div>

                      <div className="text-xs text-zinc-400 space-y-0.5 border-t border-zinc-800/80 pt-2.5">
                        <div>HP: {emp.phone}</div>
                        <div>
                          Wajah Biometrik:{' '}
                          <span className={emp.faceEnrolled ? 'text-emerald-400' : 'text-amber-300'}>
                            {emp.faceEnrolled ? 'Terdaftar' : 'Belum Terdaftar'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setDetailEmployee(emp)}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-800 bg-[#18181D] py-2 text-[11px] font-semibold text-zinc-200 hover:border-[#D4AF37]/50 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" /> Detail
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditEmployee(emp)}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-800 bg-[#18181D] py-2 text-[11px] font-semibold text-zinc-200 hover:border-[#D4AF37]/50 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEmployee(emp)}
                          className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-400 hover:bg-red-500/20 cursor-pointer"
                          title="Hapus Pegawai"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 3. MONITORING ABSENSI */}
          {activeTab === 'attendance' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-[#F6E08B]">Log Absensi & Persetujuan Lembur</h2>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="rounded-xl border border-zinc-800 bg-[#18181D] px-3 py-2 text-xs text-white"
                    />
                    <select
                      value={filterEmployeeId}
                      onChange={(e) => setFilterEmployeeId(e.target.value)}
                      className="rounded-xl border border-zinc-800 bg-[#18181D] px-3 py-2 text-xs text-white"
                    >
                      <option value="all">Semua Pegawai</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-800 text-zinc-400">
                      <tr>
                        <th className="py-2.5 pr-3">Tanggal</th>
                        <th className="py-2.5 pr-3">Pegawai</th>
                        <th className="py-2.5 pr-3">Masuk</th>
                        <th className="py-2.5 pr-3">Pulang</th>
                        <th className="py-2.5 pr-3">Kerja Bersih</th>
                        <th className="py-2.5 pr-3">Status / Anomali</th>
                        <th className="py-2.5">Aksi Admin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {attendanceList
                        .filter((a) => !selectedDate || a.dateWib === selectedDate)
                        .filter((a) => filterEmployeeId === 'all' || a.employeeId === filterEmployeeId)
                        .map((a) => (
                          <tr key={a.id}>
                            <td className="py-3 pr-3 font-mono text-zinc-300">{a.dateWib}</td>
                            <td className="py-3 pr-3 font-semibold text-white">{a.employeeName}</td>
                            <td className="py-3 pr-3 font-mono text-zinc-300">{a.checkInTime || '-'}</td>
                            <td className="py-3 pr-3 font-mono text-zinc-300">{a.checkOutTime || '-'}</td>
                            <td className="py-3 pr-3 font-mono text-[#F6E08B]">
                              {formatMinutesToDuration(a.netWorkMinutes ?? a.workMinutes)}
                            </td>
                            <td className="py-3 pr-3">
                              <span className="uppercase font-semibold text-zinc-200">
                                {a.status.replace('_', ' ')}
                              </span>
                              {(a.checkInMockSuspected || a.checkOutMockSuspected) && (
                                <span className="ml-2 text-red-400 font-semibold">· Mock GPS!</span>
                              )}
                            </td>
                            <td className="py-3 flex flex-wrap gap-1.5">
                              {!a.overtimeApproved && (a.overtimeMinutes || 0) > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleApproveOvertime(a)}
                                  className="rounded-lg bg-[#D4AF37]/20 border border-[#D4AF37]/50 px-2.5 py-1 text-[11px] font-semibold text-[#F6E08B] cursor-pointer"
                                >
                                  Setujui Lembur ({a.overtimeMinutes}m)
                                </button>
                              )}
                              {!a.reClockInApproved && (
                                <button
                                  type="button"
                                  onClick={() => handleAllowReClockIn(a)}
                                  className="rounded-lg border border-zinc-700 bg-[#18181D] px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white cursor-pointer"
                                >
                                  Izinkan Absen Ulang
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <AttendanceCalendar
                records={attendanceList}
                monthKey={selectedMonth}
                onMonthChange={setSelectedMonth}
              />
            </div>
          )}

          {/* 4. MONITORING GPS */}
          {activeTab === 'gps' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-[#F6E08B]">Monitoring GPS Pegawai Realtime</h2>
                    <p className="text-xs text-zinc-400">
                      Menampilkan posisi terbaru pegawai yang absen atau sedang mengaktifkan Tracker Perjalanan.
                    </p>
                  </div>
                  <MapLegendBadge />
                </div>

                <GoogleMapViewer markers={locationsToMarkers(locations)} heightClass="h-[420px]" />

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                  {locations.map((loc) => (
                    <div
                      key={loc.employeeId}
                      className="rounded-xl border border-zinc-800 bg-[#18181D] p-3.5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">{loc.employeeName}</span>
                        <span
                          className={`font-semibold ${
                            loc.isTracking
                              ? 'text-[#D4AF37]'
                              : loc.isOnline
                              ? 'text-emerald-400'
                              : 'text-zinc-500'
                          }`}
                        >
                          {loc.isTracking ? 'Dalam Perjalanan' : loc.isOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      <div className="text-zinc-400 truncate">{loc.address || '-'}</div>
                      <div className="font-mono text-[11px] text-zinc-500">
                        {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} · Update: {loc.lastUpdatedWib}
                      </div>
                      {loc.mockSuspected && (
                        <div className="text-red-400 font-semibold flex items-center gap-1">
                          <ShieldAlert className="w-3.5 h-3.5" /> Indikasi lokasi palsu
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 5. TRACKER PERJALANAN */}
          {activeTab === 'trips' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-[#F6E08B]">Riwayat Jalur Perjalanan Pegawai</h2>
                  <select
                    value={filterEmployeeId}
                    onChange={(e) => setFilterEmployeeId(e.target.value)}
                    className="rounded-xl border border-zinc-800 bg-[#18181D] px-3 py-2 text-xs text-white"
                  >
                    <option value="all">Semua Pegawai</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedTrip && (
                  <div className="rounded-xl border border-[#D4AF37]/40 bg-[#18181D] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-[#F6E08B]">
                          {selectedTrip.employeeName} — {selectedTrip.purpose}
                        </div>
                        <div className="text-xs font-mono text-zinc-400">
                          {selectedTrip.dateWib} · {selectedTrip.startTimeWib} s/d{' '}
                          {selectedTrip.endTimeWib || 'Aktif'} · {selectedTrip.distanceKm} km ({selectedTrip.pointsCount} titik)
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedTrip(null)}
                        className="text-xs text-zinc-400 hover:text-white cursor-pointer"
                      >
                        Tutup Peta
                      </button>
                    </div>
                    <GoogleMapViewer
                      markers={selectedTripMarkers}
                      routePoints={selectedTrip.points || []}
                      heightClass="h-[340px]"
                    />
                  </div>
                )}

                {trips.length === 0 ? (
                  <p className="text-xs text-zinc-400">Belum ada sesi perjalanan pegawai.</p>
                ) : (
                  <div className="space-y-2.5">
                    {trips
                      .filter((t) => filterEmployeeId === 'all' || t.employeeId === filterEmployeeId)
                      .map((tr) => (
                        <div
                          key={tr.id}
                          className="rounded-xl border border-zinc-800 bg-[#18181D] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="font-bold text-white">
                              {tr.employeeName} · <span className="text-[#F6E08B]">{tr.purpose}</span>
                            </div>
                            <div className="font-mono text-zinc-400">
                              {tr.dateWib} · {tr.startTimeWib} s/d {tr.endTimeWib || 'Aktif'} WIB ·{' '}
                              {tr.distanceKm} km
                            </div>
                            <div className="text-zinc-400">
                              Awal: {tr.startAddress || `${tr.startLat.toFixed(4)}, ${tr.startLng.toFixed(4)}`}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedTrip(tr)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#D4AF37] px-4 py-2 text-xs font-bold text-[#0B0B0D] shrink-0 cursor-pointer"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            <span>Lihat Jalur di Peta</span>
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. PENGAJUAN IZIN / SAKIT */}
          {activeTab === 'leaves' && (
            <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
              <h2 className="text-base font-bold text-[#F6E08B]">Persetujuan Izin, Sakit & Cuti</h2>
              {leaves.length === 0 ? (
                <p className="text-xs text-zinc-400">Belum ada pengajuan izin atau sakit.</p>
              ) : (
                <div className="space-y-3">
                  {leaves.map((lv) => (
                    <div
                      key={lv.id}
                      className="rounded-xl border border-zinc-800 bg-[#18181D] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-white text-sm">{lv.employeeName}</span>
                          <span className="text-[#F6E08B] font-semibold">
                            · {LEAVE_LABELS[lv.type]}
                          </span>
                          <span
                            className={`font-bold uppercase ${
                              lv.status === 'approved'
                                ? 'text-emerald-400'
                                : lv.status === 'rejected'
                                ? 'text-red-400'
                                : 'text-amber-300'
                            }`}
                          >
                            · {lv.status === 'approved' ? 'Disetujui' : lv.status === 'rejected' ? 'Ditolak' : 'Menunggu'}
                          </span>
                        </div>
                        <div className="font-mono text-zinc-400">
                          Periode: {lv.startDate} s/d {lv.endDate}
                        </div>
                        <p className="text-zinc-300">{lv.reason}</p>
                        {lv.attachmentData && (
                          <a
                            href={lv.attachmentData}
                            download={lv.attachmentName || 'bukti-izin'}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-[#D4AF37] hover:underline"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Unduh Bukti / Surat Dokter ({lv.attachmentName || 'lampiran'})</span>
                          </a>
                        )}
                        {lv.adminNote && (
                          <div className="text-zinc-400">Catatan Admin: {lv.adminNote}</div>
                        )}
                      </div>

                      {lv.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => {
                            setReviewingLeave(lv);
                            setAdminNote('');
                          }}
                          className="rounded-xl bg-[#D4AF37] px-4 py-2.5 text-xs font-bold text-[#0B0B0D] shrink-0 cursor-pointer"
                        >
                          Tinjau Pengajuan
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 7, 8, 9. LAPORAN HARIAN / MINGGUAN / BULANAN */}
          {(activeTab === 'report_daily' ||
            activeTab === 'report_weekly' ||
            activeTab === 'report_monthly') && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-[#F6E08B]">
                      {activeTab === 'report_daily'
                        ? 'Laporan Kehadiran Harian'
                        : activeTab === 'report_weekly'
                        ? 'Laporan Kehadiran Mingguan (7 Hari)'
                        : 'Laporan Kehadiran Bulanan'}
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Filter data, unduh Excel/PDF resmi, atau cetak laporan langsung.
                    </p>
                  </div>

                  <div className="no-print flex flex-wrap gap-2">
                    <select
                      value={filterEmployeeId}
                      onChange={(e) => setFilterEmployeeId(e.target.value)}
                      className="rounded-xl border border-zinc-800 bg-[#18181D] px-3 py-2 text-xs text-white"
                    >
                      <option value="all">Semua Pegawai</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.fullName}
                        </option>
                      ))}
                    </select>

                    {activeTab === 'report_monthly' ? (
                      <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="rounded-xl border border-zinc-800 bg-[#18181D] px-3 py-2 text-xs text-white"
                      />
                    ) : (
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="rounded-xl border border-zinc-800 bg-[#18181D] px-3 py-2 text-xs text-white"
                      />
                    )}
                  </div>
                </div>

                {/* Export Buttons */}
                <div className="no-print flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTab === 'report_daily') {
                        exportToExcel(
                          `laporan-harian-${selectedDate}`,
                          'Laporan Harian',
                          filteredAttendance.map((a) => ({
                            Tanggal: a.dateWib,
                            Nama: a.employeeName,
                            Jam_Masuk: a.checkInTime || '-',
                            Jam_Pulang: a.checkOutTime || '-',
                            Kerja_Bersih_Menit: a.netWorkMinutes ?? a.workMinutes ?? 0,
                            Terlambat_Menit: a.lateMinutes || 0,
                            Status: a.status,
                          }))
                        );
                      } else if (activeTab === 'report_weekly') {
                        exportToExcel(
                          `laporan-mingguan-${selectedDate}`,
                          'Laporan Mingguan',
                          weeklySummaryRows.map((r) => ({
                            Nama: r.employee.fullName,
                            Hari_Kerja: r.daysWorked,
                            Total_Jam: r.totalHours,
                            Terlambat: r.lateCount,
                            Izin_Sakit: r.leaveCount,
                          }))
                        );
                      } else {
                        exportToExcel(
                          `laporan-bulanan-${selectedMonth}`,
                          'Laporan Bulanan',
                          monthlySummaryRows.map((r) => ({
                            Nama: r.employee.fullName,
                            Persentase_Hadir: `${r.attendanceRate}%`,
                            Hari_Kerja: r.daysWorked,
                            Total_Jam: r.totalHours,
                            Terlambat: r.lateCount,
                            Izin_Sakit: r.leaveCount,
                            Tidak_Masuk: r.absentDays,
                          }))
                        );
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Download Excel</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (activeTab === 'report_daily') {
                        exportToPdf(
                          `laporan-harian-${selectedDate}`,
                          'Laporan Kehadiran Harian',
                          `Tanggal: ${selectedDate}`,
                          ['Tanggal', 'Nama Pegawai', 'Masuk', 'Pulang', 'Kerja Bersih', 'Status'],
                          filteredAttendance.map((a) => [
                            a.dateWib,
                            a.employeeName,
                            a.checkInTime || '-',
                            a.checkOutTime || '-',
                            formatMinutesToDuration(a.netWorkMinutes ?? a.workMinutes),
                            a.status.toUpperCase(),
                          ])
                        );
                      } else if (activeTab === 'report_weekly') {
                        exportToPdf(
                          `laporan-mingguan-${selectedDate}`,
                          'Laporan Kehadiran Mingguan',
                          `Periode 7 Hari hingga ${selectedDate}`,
                          ['Nama Pegawai', 'Hari Kerja', 'Total Jam', 'Terlambat', 'Izin/Sakit'],
                          weeklySummaryRows.map((r) => [
                            r.employee.fullName,
                            r.daysWorked,
                            `${r.totalHours} jam`,
                            r.lateCount,
                            r.leaveCount,
                          ])
                        );
                      } else {
                        exportToPdf(
                          `laporan-bulanan-${selectedMonth}`,
                          'Laporan Kehadiran Bulanan',
                          `Bulan: ${selectedMonth}`,
                          ['Nama Pegawai', 'Kehadiran', 'Total Jam', 'Terlambat', 'Izin/Sakit', 'Tidak Masuk'],
                          monthlySummaryRows.map((r) => [
                            r.employee.fullName,
                            `${r.attendanceRate}%`,
                            `${r.totalHours} jam`,
                            r.lateCount,
                            r.leaveCount,
                            r.absentDays,
                          ])
                        );
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-xs font-bold text-[#0B0B0D] cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={printReportView}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-[#18181D] px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Cetak Laporan</span>
                  </button>

                  {activeTab === 'report_monthly' && (
                    <button
                      type="button"
                      onClick={handleSaveMonthlySnapshot}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/15 px-4 py-2 text-xs font-bold text-[#F6E08B] cursor-pointer"
                    >
                      <Database className="w-4 h-4" />
                      <span>Simpan Arsip Bulanan</span>
                    </button>
                  )}
                </div>

                {/* Report Tables */}
                {activeTab === 'report_daily' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-zinc-800 text-zinc-400">
                        <tr>
                          <th className="py-2.5 pr-3">Nama Pegawai</th>
                          <th className="py-2.5 pr-3">Jam Masuk</th>
                          <th className="py-2.5 pr-3">Jam Pulang</th>
                          <th className="py-2.5 pr-3">Total Kerja</th>
                          <th className="py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/70">
                        {filteredAttendance.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-zinc-500">
                              Tidak ada catatan absensi pada tanggal {selectedDate}.
                            </td>
                          </tr>
                        ) : (
                          filteredAttendance.map((a) => (
                            <tr key={a.id}>
                              <td className="py-3 pr-3 font-semibold text-white">{a.employeeName}</td>
                              <td className="py-3 pr-3 font-mono text-zinc-300">{a.checkInTime || '-'}</td>
                              <td className="py-3 pr-3 font-mono text-zinc-300">{a.checkOutTime || '-'}</td>
                              <td className="py-3 pr-3 font-mono text-[#F6E08B]">
                                {formatMinutesToDuration(a.netWorkMinutes ?? a.workMinutes)}
                              </td>
                              <td className="py-3 uppercase font-semibold text-zinc-200">
                                {a.status.replace('_', ' ')}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeTab === 'report_weekly' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-zinc-800 text-zinc-400">
                        <tr>
                          <th className="py-2.5 pr-3">Nama Pegawai</th>
                          <th className="py-2.5 pr-3">Total Hari Kerja</th>
                          <th className="py-2.5 pr-3">Total Jam Kerja</th>
                          <th className="py-2.5 pr-3">Keterlambatan</th>
                          <th className="py-2.5">Izin & Sakit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/70">
                        {weeklySummaryRows.map((r) => (
                          <tr key={r.employee.id}>
                            <td className="py-3 pr-3 font-semibold text-white">{r.employee.fullName}</td>
                            <td className="py-3 pr-3 font-mono text-zinc-300">{r.daysWorked} hari</td>
                            <td className="py-3 pr-3 font-mono text-[#F6E08B]">{r.totalHours} jam</td>
                            <td className="py-3 pr-3 font-mono text-amber-300">{r.lateCount}x</td>
                            <td className="py-3 font-mono text-zinc-300">{r.leaveCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeTab === 'report_monthly' && (
                  <div className="space-y-5">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-zinc-800 text-zinc-400">
                          <tr>
                            <th className="py-2.5 pr-3">Nama Pegawai</th>
                            <th className="py-2.5 pr-3">Persentase Hadir</th>
                            <th className="py-2.5 pr-3">Total Jam Kerja</th>
                            <th className="py-2.5 pr-3">Terlambat</th>
                            <th className="py-2.5 pr-3">Izin/Sakit</th>
                            <th className="py-2.5">Tidak Masuk</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/70">
                          {monthlySummaryRows.map((r) => (
                            <tr key={r.employee.id}>
                              <td className="py-3 pr-3 font-semibold text-white">{r.employee.fullName}</td>
                              <td className="py-3 pr-3 font-mono text-emerald-400">{r.attendanceRate}%</td>
                              <td className="py-3 pr-3 font-mono text-[#F6E08B]">{r.totalHours} jam</td>
                              <td className="py-3 pr-3 font-mono text-amber-300">{r.lateCount}x</td>
                              <td className="py-3 pr-3 font-mono text-zinc-300">{r.leaveCount}</td>
                              <td className="py-3 font-mono text-red-300">{r.absentDays} hari</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <ProductivityChart
                      title={`Grafik Kehadiran Bulanan (${selectedMonth})`}
                      data={monthlySummaryRows.map((r) => ({
                        label: r.employee.username,
                        hadir: Math.max(0, r.daysWorked - r.lateCount),
                        terlambat: r.lateCount,
                        izin: r.leaveCount,
                      }))}
                    />

                    {monthlyReports.length > 0 && (
                      <div className="border-t border-zinc-800 pt-4 space-y-2">
                        <h3 className="text-xs font-bold text-zinc-300">Arsip Laporan Bulanan Tersimpan</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                          {monthlyReports.map((rep) => (
                            <div key={rep.id} className="rounded-xl border border-zinc-800 bg-[#18181D] p-3">
                              <div className="font-bold text-[#F6E08B]">{rep.monthKey}</div>
                              <div className="text-zinc-300 mt-0.5">{rep.summaryText}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 10. PENGATURAN JAM KERJA */}
          {activeTab === 'schedule' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await setDoc(doc(db, 'workSchedules', 'default'), {
                    ...scheduleForm,
                    id: 'default',
                    timezone: 'Asia/Jakarta',
                    updatedAt: serverTimestamp(),
                  });
                  await writeAudit('Ubah Jam Kerja', 'workSchedules', 'default', `${scheduleForm.startTime} - ${scheduleForm.endTime}`);
                  showToast('success', 'Pengaturan jam kerja operasional berhasil disimpan.');
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, 'workSchedules/default');
                }
              }}
              className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4 max-w-2xl"
            >
              <h2 className="text-base font-bold text-[#F6E08B]">Pengaturan Jam Kerja & Lembur (WIB)</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-zinc-400 mb-1">Jam Mulai Kerja</label>
                  <input
                    type="time"
                    value={scheduleForm.startTime}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })}
                    className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">Jam Selesai Kerja</label>
                  <input
                    type="time"
                    value={scheduleForm.endTime}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })}
                    className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">Batas Keterlambatan (menit)</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={scheduleForm.lateToleranceMinutes}
                    onChange={(e) =>
                      setScheduleForm({ ...scheduleForm, lateToleranceMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">Waktu Istirahat (menit)</label>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={scheduleForm.breakMinutes}
                    onChange={(e) =>
                      setScheduleForm({ ...scheduleForm, breakMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">Minimal Lembur (menit setelah pulang)</label>
                  <input
                    type="number"
                    min={15}
                    max={240}
                    value={scheduleForm.overtimeMinMinutes}
                    onChange={(e) =>
                      setScheduleForm({ ...scheduleForm, overtimeMinMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
                  />
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2.5 text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scheduleForm.requireOvertimeApproval}
                      onChange={(e) =>
                        setScheduleForm({ ...scheduleForm, requireOvertimeApproval: e.target.checked })
                      }
                      className="h-4 w-4 accent-[#D4AF37]"
                    />
                    <span>Lembur wajib persetujuan Admin</span>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                className="rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] px-6 py-3 text-xs font-bold text-[#0B0B0D] cursor-pointer"
              >
                Simpan Pengaturan Jam Kerja
              </button>
            </form>
          )}

          {/* 11. NOTIFIKASI */}
          {activeTab === 'notifications' && (
            <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#F6E08B]">Pusat Notifikasi Realtime</h2>
                {unreadNotifCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllNotificationsRead}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3 py-1.5 text-xs font-semibold text-[#F6E08B] cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Tandai Semua Dibaca</span>
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <p className="text-xs text-zinc-400">Belum ada notifikasi sistem.</p>
              ) : (
                <div className="space-y-2.5">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => !n.isRead && updateDoc(doc(db, 'notifications', n.id), { isRead: true })}
                      className={`rounded-xl border p-3.5 text-xs cursor-pointer transition ${
                        n.isRead
                          ? 'border-zinc-800 bg-[#18181D]/60 text-zinc-400'
                          : 'border-[#D4AF37]/40 bg-[#18181D] text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#F6E08B]">{n.title}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{n.createdAtWib}</span>
                      </div>
                      <p className="mt-1">{n.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 12. PENGATURAN SISTEM, BACKUP & AUDIT LOG */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await setDoc(doc(db, 'adminSettings', 'default'), {
                      ...settingsForm,
                      id: 'default',
                      timezone: 'Asia/Jakarta',
                      updatedAt: serverTimestamp(),
                    });
                    await writeAudit('Ubah Pengaturan Sistem', 'adminSettings', 'default', 'Pembaruan kebijakan & sistem');
                    showToast('success', 'Pengaturan sistem berhasil disimpan.');
                  } catch (err) {
                    handleFirestoreError(err, OperationType.WRITE, 'adminSettings/default');
                  }
                }}
                className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-[#F6E08B]">
                    Pengaturan Sistem, Privasi & Backup Data
                  </h2>
                  <button
                    type="button"
                    onClick={handleExportBackupJson}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/15 px-4 py-2 text-xs font-bold text-[#F6E08B] cursor-pointer"
                  >
                    <Database className="w-4 h-4" />
                    <span>Backup Data JSON</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-zinc-400 mb-1">Zona Waktu Resmi</label>
                    <input
                      type="text"
                      value="WIB (Asia/Jakarta)"
                      disabled
                      className="w-full rounded-xl border border-zinc-800 bg-[#0E0E12] px-3.5 py-2.5 text-sm text-zinc-400"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">Masa Retensi Data (Hari)</label>
                    <input
                      type="number"
                      min={30}
                      max={3650}
                      value={settingsForm.dataRetentionDays}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, dataRetentionDays: Number(e.target.value) })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Teks Kebijakan Privasi Perusahaan</label>
                  <textarea
                    rows={4}
                    value={settingsForm.privacyPolicyText}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, privacyPolicyText: e.target.value })
                    }
                    className="w-full rounded-xl border border-zinc-800 bg-[#18181D] p-3 text-xs text-white"
                  />
                </div>

                <div className="flex flex-wrap gap-5 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settingsForm.requireConsent}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, requireConsent: e.target.checked })
                      }
                      className="h-4 w-4 accent-[#D4AF37]"
                    />
                    <span>Wajibkan persetujuan penggunaan wajah & GPS</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settingsForm.allowMockLocation}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, allowMockLocation: e.target.checked })
                      }
                      className="h-4 w-4 accent-[#D4AF37]"
                    />
                    <span>Izinkan absensi saat terdeteksi anomali mock GPS (tidak disarankan)</span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="rounded-xl bg-[#D4AF37] px-5 py-2.5 text-xs font-bold text-[#0B0B0D] cursor-pointer"
                >
                  Simpan Pengaturan Sistem
                </button>
              </form>

              {/* Audit Logs */}
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-3">
                <h3 className="text-sm font-bold text-[#F6E08B]">Riwayat Aktivitas Admin & Audit Log</h3>
                {auditLogs.length === 0 ? (
                  <p className="text-xs text-zinc-400">Belum ada log aktivitas tercatat.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
                    {auditLogs.slice(0, 40).map((log) => (
                      <div key={log.id} className="rounded-xl border border-zinc-800 bg-[#18181D] p-3 flex flex-wrap justify-between gap-2">
                        <div>
                          <span className="font-bold text-white">{log.action}</span>
                          <span className="text-zinc-400"> · {log.details}</span>
                        </div>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {log.actorEmail || log.actorRole} · {log.timestampWib}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Admin Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 bg-[#101014] border-r border-zinc-800 p-4 flex flex-col justify-between h-full overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-extrabold text-[#F6E08B]">MENU DIREKTUR</span>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-2 text-zinc-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold cursor-pointer ${
                      activeTab === item.id ? 'bg-[#D4AF37] text-[#0B0B0D]' : 'text-zinc-300'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      {item.icon}
                      <span>{item.label}</span>
                    </span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="px-1.5 rounded bg-[#D4AF37]/20 text-[10px]">{item.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 py-3 text-xs font-bold text-red-300"
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
          <div className="flex-1 bg-black/70" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Employee Detail Drawer/Modal */}
      {detailEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl border border-[#D4AF37]/40 bg-[#121216] p-5 sm:p-6 space-y-4 my-auto max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-3">
                {detailEmployee.photoUrl ? (
                  <img
                    src={detailEmployee.photoUrl}
                    alt={detailEmployee.fullName}
                    className="h-14 w-14 rounded-xl object-cover border border-[#D4AF37]/40"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-xl bg-[#18181D] flex items-center justify-center font-bold text-[#D4AF37] text-lg">
                    {detailEmployee.fullName.charAt(0)}
                  </div>
                )}
                <div>
                  <h3 className="text-base font-bold text-white">{detailEmployee.fullName}</h3>
                  <div className="text-xs text-[#D4AF37]">
                    {detailEmployee.employeeCode} · {detailEmployee.position} · @{detailEmployee.username}
                  </div>
                  <div className="text-xs text-zinc-400">HP: {detailEmployee.phone}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailEmployee(null)}
                className="p-2 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {onPreviewEmployee && (
              <button
                type="button"
                onClick={() => {
                  const target = detailEmployee;
                  setDetailEmployee(null);
                  onPreviewEmployee(target);
                }}
                className="w-full rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/15 py-2.5 text-xs font-bold text-[#F6E08B] hover:bg-[#D4AF37]/25 cursor-pointer"
              >
                Uji Tampilan Portal Pegawai ({detailEmployee.fullName})
              </button>
            )}

            {(() => {
              const empAtt = attendanceList.find(
                (a) => a.employeeId === detailEmployee.id && a.dateWib === todayWib
              );
              const empTrips = trips.filter((t) => t.employeeId === detailEmployee.id);
              const empLeaves = leaves.filter((l) => l.employeeId === detailEmployee.id);

              return (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-3 space-y-2">
                      <div className="font-bold text-[#F6E08B]">Foto & Lokasi Masuk</div>
                      {empAtt?.checkInPhoto ? (
                        <img
                          src={empAtt.checkInPhoto}
                          alt="Masuk"
                          className="w-full h-36 object-cover rounded-lg"
                        />
                      ) : (
                        <div className="h-24 rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-500">
                          Belum absen masuk
                        </div>
                      )}
                      <div className="font-mono">Jam: {empAtt?.checkInTime || '-'}</div>
                      <div className="text-zinc-400">{empAtt?.checkInAddress || '-'}</div>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-3 space-y-2">
                      <div className="font-bold text-[#F6E08B]">Foto & Lokasi Pulang</div>
                      {empAtt?.checkOutPhoto ? (
                        <img
                          src={empAtt.checkOutPhoto}
                          alt="Pulang"
                          className="w-full h-36 object-cover rounded-lg"
                        />
                      ) : (
                        <div className="h-24 rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-500">
                          Belum absen pulang
                        </div>
                      )}
                      <div className="font-mono">Jam: {empAtt?.checkOutTime || '-'}</div>
                      <div className="text-zinc-400">{empAtt?.checkOutAddress || '-'}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-3 space-y-1">
                    <div className="font-bold text-white">
                      Total Jam Kerja Hari Ini:{' '}
                      <span className="text-[#F6E08B] font-mono">
                        {empAtt ? formatMinutesToDuration(empAtt.netWorkMinutes ?? empAtt.workMinutes) : '-'}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-3 space-y-1.5">
                    <div className="font-bold text-[#F6E08B]">Riwayat Perjalanan ({empTrips.length})</div>
                    {empTrips.slice(0, 3).map((t) => (
                      <div key={t.id} className="text-zinc-300">
                        {t.dateWib} · {t.purpose} ({t.distanceKm} km)
                      </div>
                    ))}
                    {empTrips.length === 0 && <div className="text-zinc-500">Belum ada perjalanan.</div>}
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-3 space-y-1.5">
                    <div className="font-bold text-[#F6E08B]">Riwayat Izin & Sakit ({empLeaves.length})</div>
                    {empLeaves.slice(0, 3).map((l) => (
                      <div key={l.id} className="text-zinc-300">
                        {l.startDate} · {LEAVE_LABELS[l.type]} ({l.status.toUpperCase()})
                      </div>
                    ))}
                    {empLeaves.length === 0 && <div className="text-zinc-500">Belum ada riwayat izin.</div>}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Employee Add/Edit Modal */}
      {empModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveEmployee}
            className="w-full max-w-md rounded-2xl border border-[#D4AF37]/40 bg-[#121216] p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-[#F6E08B]">
              {editingEmp ? 'Edit Data Pegawai' : 'Tambah Pegawai Baru'}
            </h3>
            <div className="space-y-3 text-xs">
              <input
                type="text"
                required
                value={empForm.fullName}
                onChange={(e) => setEmpForm({ ...empForm, fullName: e.target.value })}
                placeholder="Nama Lengkap"
                className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
              />
              <input
                type="text"
                required
                disabled={Boolean(editingEmp)}
                value={empForm.username}
                onChange={(e) => setEmpForm({ ...empForm, username: e.target.value })}
                placeholder="Username (tanpa spasi)"
                className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white disabled:opacity-50"
              />
              <input
                type="text"
                required
                value={empForm.phone}
                onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })}
                placeholder="Nomor HP"
                className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
              />
              <input
                type="text"
                required
                value={empForm.position}
                onChange={(e) => setEmpForm({ ...empForm, position: e.target.value })}
                placeholder="Jabatan"
                className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
              />
              <input
                type="email"
                value={empForm.email}
                onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })}
                placeholder="Email Google Pegawai (opsional)"
                className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
              />
              <select
                value={empForm.status}
                onChange={(e) =>
                  setEmpForm({ ...empForm, status: e.target.value as 'active' | 'inactive' })
                }
                className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
              >
                <option value="active">Status: Aktif</option>
                <option value="inactive">Status: Nonaktif</option>
              </select>
              <input
                type="password"
                value={empForm.password}
                onChange={(e) => setEmpForm({ ...empForm, password: e.target.value })}
                placeholder={editingEmp ? 'Reset Kata Sandi (kosongkan jika tetap)' : 'Password Awal (default: Rey@2026)'}
                className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEmpModalOpen(false)}
                className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-xs font-semibold text-zinc-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingEmp}
                className="flex-1 rounded-xl bg-[#D4AF37] py-2.5 text-xs font-bold text-[#0B0B0D] cursor-pointer"
              >
                {savingEmp ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Leave Review Modal */}
      {reviewingLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#D4AF37]/40 bg-[#121216] p-6 space-y-4">
            <h3 className="text-base font-bold text-[#F6E08B]">
              Tinjau Pengajuan {reviewingLeave.employeeName}
            </h3>
            <div className="text-xs text-zinc-300 space-y-1">
              <div>Jenis: {LEAVE_LABELS[reviewingLeave.type]}</div>
              <div className="font-mono">
                Tanggal: {reviewingLeave.startDate} s/d {reviewingLeave.endDate}
              </div>
              <p className="pt-1 text-zinc-200">{reviewingLeave.reason}</p>
            </div>
            <textarea
              rows={3}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder="Catatan Direktur/Admin (opsional)..."
              className="w-full rounded-xl border border-zinc-800 bg-[#18181D] p-3 text-xs text-white"
            />
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setReviewingLeave(null)}
                className="rounded-xl border border-zinc-700 px-4 py-2.5 text-xs text-zinc-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleReviewLeave('rejected')}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-xs font-bold text-white cursor-pointer"
              >
                Tolak
              </button>
              <button
                type="button"
                onClick={() => handleReviewLeave('approved')}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white cursor-pointer"
              >
                Setujui
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
