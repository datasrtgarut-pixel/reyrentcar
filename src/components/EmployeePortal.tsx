import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  History,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  Settings,
  ShieldCheck,
  Upload,
  User,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { detectMockLocationHeuristics, getCurrentGpsPosition, reverseGeocodeViaProxy } from '../lib/geolocation';
import { enqueueOfflineSync } from '../lib/offlineQueue';
import { DEFAULT_PRIVACY_POLICY, hashPasswordViaApi, verifyPasswordViaApi } from '../lib/seedData';
import {
  evaluateCheckIn,
  evaluateCheckOut,
  formatMinutesToDuration,
  formatWibDate,
  formatWibFull,
  formatWibMonthKey,
  formatWibTime,
  getServerNow,
  haversineDistanceKm,
  syncServerTime,
} from '../lib/timeWib';
import type {
  AdminSettings,
  AppNotification,
  AttendanceRecord,
  Employee,
  EmployeeCredential,
  LeaveRequest,
  LeaveType,
  TrackingPoint,
  TrackingTrip,
  UserProfile,
  WorkSchedule,
} from '../types/app';
import { AttendanceCalendar } from './AttendanceCalendar';
import { FaceCameraModal, type FaceVerificationResult } from './FaceCameraModal';
import { GoogleMapViewer, type MapMarkerItem } from './GoogleMapViewer';
import { PWAInstallButton } from './PWAInstallButton';

export type EmployeeMenuTab =
  | 'dashboard'
  | 'check_in'
  | 'check_out'
  | 'tracker'
  | 'leave'
  | 'history_attendance'
  | 'history_trips'
  | 'profile'
  | 'settings';

interface EmployeePortalProps {
  uid: string;
  userProfile: UserProfile;
  employee: Employee;
  schedule: WorkSchedule;
  settings: AdminSettings;
  onLogout: () => void;
  isAdminPreview?: boolean;
  onExitPreview?: () => void;
}

const LEAVE_LABELS: Record<LeaveType, string> = {
  izin_pribadi: 'Izin Pribadi',
  sakit: 'Sakit',
  cuti: 'Cuti',
  tidak_masuk: 'Tidak Masuk Kerja',
  keperluan_mendesak: 'Keperluan Mendesak',
};

const DEFAULT_SCHEDULE: WorkSchedule = {
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

export const EmployeePortal: React.FC<EmployeePortalProps> = ({
  uid,
  employee,
  schedule = DEFAULT_SCHEDULE,
  settings,
  onLogout,
  isAdminPreview = false,
  onExitPreview,
}) => {
  const [activeTab, setActiveTab] = useState<EmployeeMenuTab>('dashboard');
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const [nowWib, setNowWib] = useState<Date>(() => getServerNow());
  const [calendarMonth, setCalendarMonth] = useState(() => formatWibMonthKey(getServerNow()));

  const [attendanceList, setAttendanceList] = useState<AttendanceRecord[]>([]);
  const [trips, setTrips] = useState<TrackingTrip[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [cameraMode, setCameraMode] = useState<'check_in' | 'check_out' | 'enroll' | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Trip Tracker state
  const [tripPurpose, setTripPurpose] = useState('');
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [trackerBusy, setTrackerBusy] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const lastSyncEpochRef = useRef<number>(0);

  // Leave form state
  const [leaveType, setLeaveType] = useState<LeaveType>('izin_pribadi');
  const [leaveStart, setLeaveStart] = useState(() => formatWibDate(getServerNow()));
  const [leaveEnd, setLeaveEnd] = useState(() => formatWibDate(getServerNow()));
  const [leaveReason, setLeaveReason] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentType, setAttachmentType] = useState('');
  const [attachmentData, setAttachmentData] = useState('');
  const [submittingLeave, setSubmittingLeave] = useState(false);

  // Password change state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPass, setChangingPass] = useState(false);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 5000);
  };

  // Sync server clock & update WIB ticker
  useEffect(() => {
    syncServerTime();
    const interval = setInterval(() => {
      setNowWib(getServerNow());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Firestore realtime listeners scoped to current user UID (strictly matches firestore.rules allow list!)
  useEffect(() => {
    const qAtt = query(
      collection(db, 'attendance'),
      where('uid', '==', uid),
      orderBy('dateWib', 'desc')
    );
    const unsubAtt = onSnapshot(
      qAtt,
      (snap) => {
        setAttendanceList(snap.docs.map((d) => d.data() as AttendanceRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'attendance')
    );

    const qTrips = query(
      collection(db, 'trackingHistory'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    const unsubTrips = onSnapshot(
      qTrips,
      (snap) => {
        setTrips(snap.docs.map((d) => d.data() as TrackingTrip));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'trackingHistory')
    );

    const qLeaves = query(
      collection(db, 'leaveRequests'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    const unsubLeaves = onSnapshot(
      qLeaves,
      (snap) => {
        setLeaves(snap.docs.map((d) => d.data() as LeaveRequest));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'leaveRequests')
    );

    const qNotif = query(
      collection(db, 'notifications'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    const unsubNotif = onSnapshot(
      qNotif,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as AppNotification)
          .filter((n) => n.targetRole === 'employee');
        setNotifications(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );

    return () => {
      unsubAtt();
      unsubTrips();
      unsubLeaves();
      unsubNotif();
    };
  }, [uid]);

  const todayDate = formatWibDate(nowWib);
  const todayAttendance = useMemo(
    () => attendanceList.find((a) => a.dateWib === todayDate) || null,
    [attendanceList, todayDate]
  );

  const activeTrip = useMemo(
    () => trips.find((t) => t.status === 'active') || null,
    [trips]
  );

  const liveWorkMinutes = useMemo(() => {
    if (!todayAttendance?.checkInEpoch) return 0;
    if (todayAttendance.checkOutEpoch) return todayAttendance.netWorkMinutes ?? todayAttendance.workMinutes ?? 0;
    return Math.max(0, Math.round((nowWib.getTime() - todayAttendance.checkInEpoch) / 60000));
  }, [todayAttendance, nowWib]);

  const totalHoursThisMonth = useMemo(() => {
    const mKey = formatWibMonthKey(nowWib);
    const totalMins = attendanceList
      .filter((a) => a.dateWib.startsWith(mKey))
      .reduce((sum, a) => sum + (a.netWorkMinutes ?? a.workMinutes ?? 0), 0);
    return Math.round((totalMins / 60) * 10) / 10;
  }, [attendanceList, nowWib]);

  const sendAdminNotification = async (
    category: AppNotification['category'],
    title: string,
    message: string
  ) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      await setDoc(doc(db, 'notifications', id), {
        id,
        targetRole: 'admin',
        targetEmployeeId: employee.id,
        uid,
        category,
        title,
        message,
        isRead: false,
        createdAtWib: formatWibFull(getServerNow()),
        createdAt: serverTimestamp(),
      });
    } catch {
      // Non-blocking
    }
  };

  const writeAuditLog = async (action: string, targetCollection: string, targetId: string, details: string) => {
    const id = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      await setDoc(doc(db, 'auditLogs', id), {
        id,
        actorUid: uid,
        actorEmail: employee.email || employee.username,
        actorRole: 'employee',
        action,
        targetCollection,
        targetId,
        details: details.slice(0, 390),
        timestampWib: formatWibFull(getServerNow()),
        createdAt: serverTimestamp(),
      });
    } catch {
      // Non-blocking
    }
  };

  // --- ATTENDANCE CHECK-IN / CHECK-OUT / ENROLL ---
  const handleCameraVerified = async (res: FaceVerificationResult) => {
    if (!cameraMode) return;
    const serverDateObj = new Date(res.serverEpochMs);
    const dateKey = formatWibDate(serverDateObj);
    const timeStr = formatWibTime(serverDateObj);

    if (cameraMode === 'enroll') {
      try {
        await updateDoc(doc(db, 'employees', employee.id), {
          photoUrl: res.photoData,
          faceEnrolled: true,
          faceSignature: res.signature,
          updatedAt: serverTimestamp(),
        });

        const fvId = `fv-${Date.now()}`;
        await setDoc(doc(db, 'faceVerification', fvId), {
          id: fvId,
          employeeId: employee.id,
          uid,
          actionType: 'enroll',
          livenessPassed: res.livenessPassed,
          challengePrompt: res.challengePrompt,
          similarityScore: res.similarityScore,
          photoData: res.photoData,
          timestampWib: res.serverTimeWib,
          createdAt: serverTimestamp(),
        });

        await writeAuditLog('Pendaftaran Wajah Biometrik', 'employees', employee.id, `Skor hidup: ${res.similarityScore}%`);
        setCameraMode(null);
        showToast('success', 'Data wajah biometrik berhasil didaftarkan.');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `employees/${employee.id}`);
      }
      return;
    }

    if (cameraMode === 'check_in') {
      if (todayAttendance?.checkInTime && !todayAttendance?.reClockInApproved) {
        setCameraMode(null);
        showToast('error', 'Anda sudah melakukan absen masuk hari ini.');
        return;
      }

      if (res.gps.mockSuspected && !settings.allowMockLocation) {
        setCameraMode(null);
        showToast('error', `Absen masuk ditolak: ${res.gps.mockReason}`);
        await sendAdminNotification('gps_alert', 'Indikasi Lokasi Palsu', `${employee.fullName} memicu deteksi lokasi palsu: ${res.gps.mockReason}`);
        return;
      }

      const evalIn = evaluateCheckIn(serverDateObj, schedule);
      const attId = `att-${employee.id}-${dateKey}`;

      const payload: AttendanceRecord = {
        id: attId,
        employeeId: employee.id,
        employeeName: employee.fullName,
        uid,
        dateWib: dateKey,
        checkInTime: timeStr,
        checkInEpoch: res.serverEpochMs,
        checkInLat: res.gps.lat,
        checkInLng: res.gps.lng,
        checkInAccuracy: res.gps.accuracy,
        checkInAddress: res.gps.address,
        checkInPhoto: res.photoData,
        checkInLivenessScore: res.similarityScore,
        checkInMockSuspected: res.gps.mockSuspected,
        checkInMockReason: res.gps.mockReason || '',
        status: evalIn.status,
        lateMinutes: evalIn.lateMinutes,
        overtimeApproved: false,
        reClockInApproved: false,
      };

      try {
        await setDoc(doc(db, 'attendance', attId), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        // Auto-enroll face if not yet enrolled
        if (!employee.faceEnrolled) {
          await updateDoc(doc(db, 'employees', employee.id), {
            faceEnrolled: true,
            faceSignature: res.signature,
            photoUrl: employee.photoUrl || res.photoData,
            updatedAt: serverTimestamp(),
          });
        }

        const fvId = `fv-${Date.now()}`;
        await setDoc(doc(db, 'faceVerification', fvId), {
          id: fvId,
          employeeId: employee.id,
          uid,
          actionType: 'check_in',
          livenessPassed: true,
          challengePrompt: res.challengePrompt,
          similarityScore: res.similarityScore,
          photoData: res.photoData,
          timestampWib: res.serverTimeWib,
          createdAt: serverTimestamp(),
        });

        await setDoc(doc(db, 'locations', employee.id), {
          employeeId: employee.id,
          employeeName: employee.fullName,
          uid,
          lat: res.gps.lat,
          lng: res.gps.lng,
          accuracy: res.gps.accuracy,
          speed: res.gps.speed,
          address: res.gps.address,
          isTracking: Boolean(activeTrip),
          isOnline: navigator.onLine,
          activeTripId: activeTrip?.id || '',
          mockSuspected: res.gps.mockSuspected,
          lastUpdatedWib: res.serverTimeWib,
          updatedAt: serverTimestamp(),
        });

        await sendAdminNotification(
          evalIn.isLate ? 'late' : 'check_in',
          evalIn.isLate ? 'Pegawai Terlambat Masuk' : 'Pegawai Absen Masuk',
          `${employee.fullName} absen masuk pukul ${timeStr} WIB${evalIn.isLate ? ` (Terlambat ${evalIn.lateMinutes} menit)` : ''} di ${res.gps.address}.`
        );

        await writeAuditLog('Absen Masuk', 'attendance', attId, `Masuk ${timeStr} WIB (${res.gps.lat.toFixed(5)}, ${res.gps.lng.toFixed(5)})`);
        setCameraMode(null);
        showToast('success', `Absen masuk tercatat pukul ${timeStr} WIB.`);
      } catch (err) {
        if (!navigator.onLine) {
          enqueueOfflineSync({
            id: attId,
            collectionName: 'attendance',
            docId: attId,
            mode: 'set',
            payload: payload as unknown as Record<string, unknown>,
            createdAtIso: new Date().toISOString(),
          });
          setCameraMode(null);
          showToast('success', 'Mode Offline: Absen masuk disimpan & akan disinkronkan otomatis.');
        } else {
          handleFirestoreError(err, OperationType.WRITE, `attendance/${attId}`);
        }
      }
      return;
    }

    if (cameraMode === 'check_out') {
      if (!todayAttendance || !todayAttendance.checkInEpoch) {
        setCameraMode(null);
        showToast('error', 'Anda belum melakukan absen masuk hari ini.');
        return;
      }
      if (todayAttendance.checkOutTime && !todayAttendance.reClockInApproved) {
        setCameraMode(null);
        showToast('error', 'Anda sudah melakukan absen pulang hari ini.');
        return;
      }

      const evalOut = evaluateCheckOut(
        todayAttendance.checkInEpoch,
        res.serverEpochMs,
        todayAttendance.lateMinutes || 0,
        schedule,
        Boolean(todayAttendance.overtimeApproved)
      );

      const updateFields = {
        checkOutTime: timeStr,
        checkOutEpoch: res.serverEpochMs,
        checkOutLat: res.gps.lat,
        checkOutLng: res.gps.lng,
        checkOutAccuracy: res.gps.accuracy,
        checkOutAddress: res.gps.address,
        checkOutPhoto: res.photoData,
        checkOutLivenessScore: res.similarityScore,
        checkOutMockSuspected: res.gps.mockSuspected,
        checkOutMockReason: res.gps.mockReason || '',
        status: evalOut.status,
        workMinutes: evalOut.workMinutes,
        netWorkMinutes: evalOut.netWorkMinutes,
        breakDeductedMinutes: evalOut.breakDeductedMinutes,
        earlyLeaveMinutes: evalOut.earlyLeaveMinutes,
        overtimeMinutes: evalOut.overtimeMinutes,
        updatedAt: serverTimestamp(),
      };

      try {
        await updateDoc(doc(db, 'attendance', todayAttendance.id), updateFields);

        const fvId = `fv-${Date.now()}`;
        await setDoc(doc(db, 'faceVerification', fvId), {
          id: fvId,
          employeeId: employee.id,
          uid,
          actionType: 'check_out',
          livenessPassed: true,
          challengePrompt: res.challengePrompt,
          similarityScore: res.similarityScore,
          photoData: res.photoData,
          timestampWib: res.serverTimeWib,
          createdAt: serverTimestamp(),
        });

        await setDoc(doc(db, 'locations', employee.id), {
          employeeId: employee.id,
          employeeName: employee.fullName,
          uid,
          lat: res.gps.lat,
          lng: res.gps.lng,
          accuracy: res.gps.accuracy,
          speed: res.gps.speed,
          address: res.gps.address,
          isTracking: Boolean(activeTrip),
          isOnline: navigator.onLine,
          activeTripId: activeTrip?.id || '',
          mockSuspected: res.gps.mockSuspected,
          lastUpdatedWib: res.serverTimeWib,
          updatedAt: serverTimestamp(),
        });

        await sendAdminNotification(
          'check_out',
          'Pegawai Absen Pulang',
          `${employee.fullName} absen pulang pukul ${timeStr} WIB. Total kerja bersih: ${formatMinutesToDuration(evalOut.netWorkMinutes)}.`
        );

        await writeAuditLog('Absen Pulang', 'attendance', todayAttendance.id, `Pulang ${timeStr} WIB`);
        setCameraMode(null);
        showToast('success', `Absen pulang tercatat pukul ${timeStr} WIB.`);
      } catch (err) {
        if (!navigator.onLine) {
          enqueueOfflineSync({
            id: `${todayAttendance.id}-out`,
            collectionName: 'attendance',
            docId: todayAttendance.id,
            mode: 'update',
            payload: updateFields as unknown as Record<string, unknown>,
            createdAtIso: new Date().toISOString(),
          });
          setCameraMode(null);
          showToast('success', 'Mode Offline: Absen pulang tersimpan & siap disinkronkan.');
        } else {
          handleFirestoreError(err, OperationType.UPDATE, `attendance/${todayAttendance.id}`);
        }
      }
    }
  };

  // --- GPS TRIP TRACKER ---
  useEffect(() => {
    if (!activeTrip) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!navigator.geolocation) {
      setTrackerError('Perangkat tidak mendukung pelacakan GPS.');
      return;
    }

    const activeTripSnapshot = activeTrip;
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        setTrackerError(null);
        const nowMs = Date.now();
        if (nowMs - lastSyncEpochRef.current < 12000) return; // throttle every 12s
        lastSyncEpochRef.current = nowMs;

        const { latitude, longitude, accuracy, speed } = pos.coords;
        const { mockSuspected } = detectMockLocationHeuristics(latitude, longitude, accuracy, speed);
        const srvNow = getServerNow();
        const wibTimeStr = formatWibTime(srvNow);
        const wibFullStr = formatWibFull(srvNow);

        const prevPoints = activeTripSnapshot.points || [];
        const lastPt = prevPoints[prevPoints.length - 1];
        const segKm = lastPt
          ? haversineDistanceKm(lastPt.lat, lastPt.lng, latitude, longitude)
          : 0;
        const nextDistKm = Math.round((activeTripSnapshot.distanceKm + segKm) * 100) / 100;

        const newPt: TrackingPoint = {
          lat: latitude,
          lng: longitude,
          ts: srvNow.getTime(),
          wibTime: wibTimeStr,
          accuracy: Math.round(accuracy),
        };

        const updatedPoints = [...prevPoints, newPt].slice(-250);

        const tripUpdate = {
          distanceKm: nextDistKm,
          pointsCount: activeTripSnapshot.pointsCount + 1,
          points: updatedPoints,
          updatedAt: serverTimestamp(),
        };

        const locPayload = {
          employeeId: employee.id,
          employeeName: employee.fullName,
          uid,
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy),
          speed: speed ? Math.round(speed * 3.6) : 0,
          address: `Pelacakan Aktif · ${activeTripSnapshot.purpose}`,
          isTracking: true,
          isOnline: navigator.onLine,
          activeTripId: activeTripSnapshot.id,
          mockSuspected,
          lastUpdatedWib: wibFullStr,
          updatedAt: serverTimestamp(),
        };

        if (!navigator.onLine) {
          enqueueOfflineSync({
            id: `trip-${activeTripSnapshot.id}`,
            collectionName: 'trackingHistory',
            docId: activeTripSnapshot.id,
            mode: 'update',
            payload: { distanceKm: nextDistKm, pointsCount: tripUpdate.pointsCount, points: updatedPoints },
            createdAtIso: new Date().toISOString(),
          });
          enqueueOfflineSync({
            id: `loc-${employee.id}`,
            collectionName: 'locations',
            docId: employee.id,
            mode: 'set',
            payload: locPayload,
            createdAtIso: new Date().toISOString(),
          });
          return;
        }

        try {
          await updateDoc(doc(db, 'trackingHistory', activeTripSnapshot.id), tripUpdate);
          await setDoc(doc(db, 'locations', employee.id), locPayload);
        } catch {
          // Will retry on next tick
        }
      },
      async (err) => {
        setTrackerError(`Sinyal GPS terputus: ${err.message}`);
        await sendAdminNotification(
          'gps_alert',
          'GPS Pegawai Terputus',
          `GPS ${employee.fullName} tidak tersedia saat pelacakan perjalanan aktif.`
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [activeTrip?.id, activeTrip?.pointsCount]);

  const handleStartTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    const purposeClean = tripPurpose.trim();
    if (purposeClean.length < 3) {
      showToast('error', 'Tuliskan tujuan atau tugas perjalanan terlebih dahulu.');
      return;
    }

    setTrackerBusy(true);
    setTrackerError(null);
    try {
      await syncServerTime();
      const pos = await getCurrentGpsPosition();
      const srvNow = getServerNow();
      const tripId = `trip-${employee.id}-${Date.now()}`;
      const startTimeWib = formatWibTime(srvNow);
      const startPoint: TrackingPoint = {
        lat: pos.lat,
        lng: pos.lng,
        ts: srvNow.getTime(),
        wibTime: startTimeWib,
        accuracy: pos.accuracy,
      };

      await setDoc(doc(db, 'trackingHistory', tripId), {
        id: tripId,
        employeeId: employee.id,
        employeeName: employee.fullName,
        uid,
        dateWib: formatWibDate(srvNow),
        purpose: purposeClean,
        status: 'active',
        startTimeWib,
        startLat: pos.lat,
        startLng: pos.lng,
        startAddress: pos.address,
        distanceKm: 0,
        pointsCount: 1,
        points: [startPoint],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'locations', employee.id), {
        employeeId: employee.id,
        employeeName: employee.fullName,
        uid,
        lat: pos.lat,
        lng: pos.lng,
        accuracy: pos.accuracy,
        speed: pos.speed,
        address: pos.address,
        isTracking: true,
        isOnline: navigator.onLine,
        activeTripId: tripId,
        mockSuspected: pos.mockSuspected,
        lastUpdatedWib: formatWibFull(srvNow),
        updatedAt: serverTimestamp(),
      });

      await sendAdminNotification(
        'tracking',
        'Pelacakan Perjalanan Dimulai',
        `${employee.fullName} memulai perjalanan: "${purposeClean}" dari ${pos.address}.`
      );
      await writeAuditLog('Mulai Tracker Perjalanan', 'trackingHistory', tripId, purposeClean);
      setTripPurpose('');
      showToast('success', 'Tracker perjalanan aktif. Posisi GPS Anda dipantau secara transparan.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memulai tracker.';
      setTrackerError(msg);
      showToast('error', msg);
    } finally {
      setTrackerBusy(false);
    }
  };

  const handleStopTrip = async () => {
    if (!activeTrip) return;
    setTrackerBusy(true);
    try {
      await syncServerTime();
      const srvNow = getServerNow();
      const endTimeWib = formatWibTime(srvNow);
      const lastPt = activeTrip.points[activeTrip.points.length - 1];
      let endLat = lastPt?.lat ?? activeTrip.startLat;
      let endLng = lastPt?.lng ?? activeTrip.startLng;
      let endAddress = activeTrip.startAddress || '';

      try {
        const pos = await getCurrentGpsPosition();
        endLat = pos.lat;
        endLng = pos.lng;
        endAddress = pos.address;
      } catch {
        endAddress = await reverseGeocodeViaProxy(endLat, endLng);
      }

      const finalSeg = lastPt ? haversineDistanceKm(lastPt.lat, lastPt.lng, endLat, endLng) : 0;
      const totalDist = Math.round((activeTrip.distanceKm + finalSeg) * 100) / 100;

      await updateDoc(doc(db, 'trackingHistory', activeTrip.id), {
        status: 'completed',
        endTimeWib,
        endLat,
        endLng,
        endAddress,
        distanceKm: totalDist,
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'locations', employee.id), {
        employeeId: employee.id,
        employeeName: employee.fullName,
        uid,
        lat: endLat,
        lng: endLng,
        accuracy: 15,
        speed: 0,
        address: endAddress,
        isTracking: false,
        isOnline: navigator.onLine,
        activeTripId: '',
        mockSuspected: false,
        lastUpdatedWib: formatWibFull(srvNow),
        updatedAt: serverTimestamp(),
      });

      await sendAdminNotification(
        'tracking',
        'Tracker Perjalanan Dihentikan',
        `${employee.fullName} mengakhiri perjalanan (${totalDist} km) di ${endAddress}.`
      );
      await writeAuditLog('Hentikan Tracker Perjalanan', 'trackingHistory', activeTrip.id, `Total ${totalDist} km`);
      showToast('success', `Perjalanan selesai. Total jarak tempuh: ${totalDist} km.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trackingHistory/${activeTrip.id}`);
    } finally {
      setTrackerBusy(false);
    }
  };

  // --- LEAVE REQUEST SUBMISSION ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 480 * 1024) {
      showToast('error', 'Ukuran file maksimal 480 KB agar dapat tersimpan dengan aman.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setAttachmentName(file.name);
      setAttachmentType(file.type || 'application/octet-stream');
      setAttachmentData(result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (leaveReason.trim().length < 3) {
      showToast('error', 'Tuliskan alasan/keterangan minimal 3 karakter.');
      return;
    }

    setSubmittingLeave(true);
    try {
      const reqId = `leave-${employee.id}-${Date.now()}`;
      await setDoc(doc(db, 'leaveRequests', reqId), {
        id: reqId,
        employeeId: employee.id,
        employeeName: employee.fullName,
        uid,
        type: leaveType,
        startDate: leaveStart,
        endDate: leaveEnd,
        reason: leaveReason.trim(),
        attachmentName: attachmentName || '',
        attachmentType: attachmentType || '',
        attachmentData: attachmentData || '',
        status: 'pending',
        adminNote: '',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await sendAdminNotification(
        'leave',
        `Pengajuan ${LEAVE_LABELS[leaveType]}`,
        `${employee.fullName} mengajukan ${LEAVE_LABELS[leaveType]} (${leaveStart} s/d ${leaveEnd}).`
      );
      await writeAuditLog('Ajukan Izin/Sakit', 'leaveRequests', reqId, `${LEAVE_LABELS[leaveType]}: ${leaveStart}`);

      setLeaveReason('');
      setAttachmentName('');
      setAttachmentType('');
      setAttachmentData('');
      showToast('success', 'Pengajuan berhasil dikirim ke Direktur/Admin.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'leaveRequests');
    } finally {
      setSubmittingLeave(false);
    }
  };

  // --- CHANGE PASSWORD ---
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      showToast('error', 'Kata sandi baru minimal 6 karakter.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('error', 'Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setChangingPass(true);
    try {
      const credRef = doc(db, 'employeeCredentials', employee.username);
      const snap = await getDoc(credRef);
      if (snap.exists()) {
        const cred = snap.data() as EmployeeCredential;
        const ok = await verifyPasswordViaApi(oldPassword, cred.passwordSalt, cred.passwordHash);
        if (!ok) {
          showToast('error', 'Kata sandi lama tidak sesuai.');
          setChangingPass(false);
          return;
        }
      }

      const { hash, salt } = await hashPasswordViaApi(newPassword);
      await updateDoc(credRef, {
        passwordHash: hash,
        passwordSalt: salt,
        mustChangePassword: false,
        updatedAt: serverTimestamp(),
      });

      await writeAuditLog('Ubah Kata Sandi', 'employeeCredentials', employee.username, 'Pembaruan kata sandi pegawai');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast('success', 'Kata sandi berhasil diperbarui.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `employeeCredentials/${employee.username}`);
    } finally {
      setChangingPass(false);
    }
  };

  const navItems: Array<{ id: EmployeeMenuTab; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'check_in', label: 'Absen Masuk', icon: <LogIn className="w-4 h-4" /> },
    { id: 'check_out', label: 'Absen Pulang', icon: <LogOut className="w-4 h-4" /> },
    { id: 'tracker', label: 'Tracker Perjalanan', icon: <Navigation className="w-4 h-4" /> },
    { id: 'leave', label: 'Pengajuan Izin/Sakit', icon: <FileText className="w-4 h-4" /> },
    { id: 'history_attendance', label: 'Riwayat Absensi', icon: <Calendar className="w-4 h-4" /> },
    { id: 'history_trips', label: 'Riwayat Perjalanan', icon: <History className="w-4 h-4" /> },
    { id: 'profile', label: 'Profil Saya', icon: <User className="w-4 h-4" /> },
    { id: 'settings', label: 'Pengaturan', icon: <Settings className="w-4 h-4" /> },
  ];

  const todayMapMarkers: MapMarkerItem[] = useMemo(() => {
    const m: MapMarkerItem[] = [];
    if (todayAttendance?.checkInLat && todayAttendance?.checkInLng) {
      m.push({
        id: 'att-in',
        title: `Masuk · ${todayAttendance.checkInTime}`,
        subtitle: employee.fullName,
        lat: todayAttendance.checkInLat,
        lng: todayAttendance.checkInLng,
        address: todayAttendance.checkInAddress,
        accuracy: todayAttendance.checkInAccuracy,
        badgeType: 'start',
      });
    }
    if (todayAttendance?.checkOutLat && todayAttendance?.checkOutLng) {
      m.push({
        id: 'att-out',
        title: `Pulang · ${todayAttendance.checkOutTime}`,
        subtitle: employee.fullName,
        lat: todayAttendance.checkOutLat,
        lng: todayAttendance.checkOutLng,
        address: todayAttendance.checkOutAddress,
        accuracy: todayAttendance.checkOutAccuracy,
        badgeType: 'end',
      });
    }
    return m;
  }, [todayAttendance, employee.fullName]);

  const activeTripMarkers: MapMarkerItem[] = useMemo(() => {
    if (!activeTrip) return [];
    const list: MapMarkerItem[] = [
      {
        id: 'trip-start',
        title: `Awal · ${activeTrip.startTimeWib}`,
        subtitle: activeTrip.purpose,
        lat: activeTrip.startLat,
        lng: activeTrip.startLng,
        address: activeTrip.startAddress,
        badgeType: 'start',
      },
    ];
    const last = activeTrip.points[activeTrip.points.length - 1];
    if (last && activeTrip.points.length > 1) {
      list.push({
        id: 'trip-curr',
        title: employee.fullName,
        subtitle: `Update ${last.wibTime} WIB`,
        lat: last.lat,
        lng: last.lng,
        isTracking: true,
        badgeType: 'employee',
      });
    }
    return list;
  }, [activeTrip, employee.fullName]);

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-[#F8F7F4] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-zinc-800/80 bg-[#101014] p-4 justify-between">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <img
              src="/assets/aistudio/logo_77714fbc.jpg"
              alt="REY RENT CAR"
              referrerPolicy="no-referrer"
              className="h-10 w-14 rounded-lg object-cover border border-[#D4AF37]/40 bg-black"
            />
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-[#F6E08B] truncate">REY RENT CAR</div>
              <div className="text-[11px] text-zinc-400 truncate">Portal Pegawai</div>
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
                  activeTab === item.id
                    ? 'bg-[#D4AF37] text-[#0B0B0D]'
                    : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="space-y-2 border-t border-zinc-800 pt-4">
          {isAdminPreview && onExitPreview && (
            <button
              type="button"
              onClick={onExitPreview}
              className="w-full rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/10 py-2.5 text-xs font-semibold text-[#F6E08B] hover:bg-[#D4AF37]/20 cursor-pointer"
            >
              Kembali ke Mode Direktur
            </button>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-800 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen pb-20 lg:pb-6">
        {/* Compact Sticky Header */}
        <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#0B0B0D]/90 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden rounded-xl border border-zinc-800 bg-[#141418] p-2 text-zinc-200 cursor-pointer"
              aria-label="Buka menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-sm font-bold text-white truncate">
                {navItems.find((n) => n.id === activeTab)?.label}
              </div>
              <div className="text-[11px] font-mono text-[#D4AF37] truncate">
                {formatWibTime(nowWib)} WIB · {employee.fullName}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeTrip && (
              <button
                type="button"
                onClick={() => setActiveTab('tracker')}
                className="rounded-lg bg-[#D4AF37]/20 border border-[#D4AF37]/50 px-2.5 py-1.5 text-[11px] font-bold text-[#F6E08B] cursor-pointer"
              >
                GPS Aktif · {activeTrip.distanceKm} km
              </button>
            )}
            <PWAInstallButton compact />
          </div>
        </header>

        {/* Active Tracker Banner */}
        {activeTrip && (
          <div className="bg-[#D4AF37] text-[#0B0B0D] px-4 py-2 text-xs font-bold flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Navigation className="w-4 h-4" />
              <span>
                TRACKER PERJALANAN AKTIF — {activeTrip.purpose} ({activeTrip.distanceKm} km · {activeTrip.pointsCount} titik)
              </span>
            </div>
            <button
              type="button"
              onClick={handleStopTrip}
              disabled={trackerBusy}
              className="rounded-lg bg-[#0B0B0D] px-3 py-1 text-[11px] font-semibold text-[#F6E08B] cursor-pointer"
            >
              Hentikan Tracker
            </button>
          </div>
        )}

        {toastMsg && (
          <div className="px-4 pt-4">
            <div
              className={`rounded-xl border p-3.5 text-xs font-medium flex items-center justify-between gap-3 ${
                toastMsg.type === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/40 bg-red-500/10 text-red-200'
              }`}
            >
              <span>{toastMsg.text}</span>
              <button type="button" onClick={() => setToastMsg(null)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-5xl w-full mx-auto space-y-6">
          {/* 1. DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[#D4AF37]/30 bg-gradient-to-br from-[#16161C] to-[#101014] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs text-[#D4AF37] font-semibold">
                    {employee.employeeCode} · {employee.position}
                  </div>
                  <h2 className="text-xl font-extrabold text-white">{employee.fullName}</h2>
                  <p className="text-xs font-mono text-zinc-400">{formatWibFull(nowWib)}</p>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  {!todayAttendance?.checkInTime || todayAttendance?.reClockInApproved ? (
                    <button
                      type="button"
                      onClick={() => setCameraMode('check_in')}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] px-4 py-3 text-xs font-bold text-[#0B0B0D] cursor-pointer min-h-[44px]"
                    >
                      <Camera className="w-4 h-4" />
                      <span>ABSEN MASUK</span>
                    </button>
                  ) : !todayAttendance?.checkOutTime ? (
                    <button
                      type="button"
                      onClick={() => setCameraMode('check_out')}
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-bold text-[#0B0B0D] cursor-pointer min-h-[44px]"
                    >
                      <Camera className="w-4 h-4" />
                      <span>ABSEN PULANG</span>
                    </button>
                  ) : (
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300">
                      Absensi Hari Ini Selesai
                    </div>
                  )}
                </div>
              </div>

              {/* KPI Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-4">
                  <div className="text-[11px] text-zinc-400">Status Hari Ini</div>
                  <div className="mt-1 text-sm font-bold text-[#F6E08B] uppercase">
                    {todayAttendance?.checkOutTime
                      ? todayAttendance.status.replace('_', ' ')
                      : todayAttendance?.checkInTime
                      ? 'BELUM ABSEN PULANG'
                      : 'BELUM ABSEN MASUK'}
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-4">
                  <div className="text-[11px] text-zinc-400">Jam Masuk / Pulang</div>
                  <div className="mt-1 text-sm font-bold font-mono text-white">
                    {todayAttendance?.checkInTime?.slice(0, 5) || '--:--'} /{' '}
                    {todayAttendance?.checkOutTime?.slice(0, 5) || '--:--'}
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-4">
                  <div className="text-[11px] text-zinc-400">Durasi Kerja Hari Ini</div>
                  <div className="mt-1 text-sm font-bold font-mono text-emerald-300">
                    {todayAttendance?.checkInEpoch ? formatMinutesToDuration(liveWorkMinutes) : '-'}
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-4">
                  <div className="text-[11px] text-zinc-400">Total Jam Bulan Ini</div>
                  <div className="mt-1 text-sm font-bold font-mono text-[#F6E08B]">
                    {totalHoursThisMonth} jam
                  </div>
                </div>
              </div>

              {/* Work Schedule & Notifications */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-3">
                  <h3 className="text-sm font-bold text-[#F6E08B]">Ketentuan Jam Kerja Aktif</h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl bg-[#18181D] p-3 border border-zinc-800">
                      <span className="text-zinc-400 block">Jam Masuk</span>
                      <span className="font-mono font-bold text-white">{schedule.startTime} WIB</span>
                    </div>
                    <div className="rounded-xl bg-[#18181D] p-3 border border-zinc-800">
                      <span className="text-zinc-400 block">Jam Pulang</span>
                      <span className="font-mono font-bold text-white">{schedule.endTime} WIB</span>
                    </div>
                    <div className="rounded-xl bg-[#18181D] p-3 border border-zinc-800">
                      <span className="text-zinc-400 block">Toleransi Telat</span>
                      <span className="font-mono font-bold text-white">{schedule.lateToleranceMinutes} menit</span>
                    </div>
                    <div className="rounded-xl bg-[#18181D] p-3 border border-zinc-800">
                      <span className="text-zinc-400 block">Potongan Istirahat</span>
                      <span className="font-mono font-bold text-white">{schedule.breakMinutes} menit</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-3">
                  <h3 className="text-sm font-bold text-[#F6E08B]">Pemberitahuan Terbaru</h3>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-zinc-400">Belum ada pemberitahuan terbaru dari Admin.</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {notifications.slice(0, 5).map((n) => (
                        <div key={n.id} className="rounded-xl bg-[#18181D] border border-zinc-800 p-3 text-xs">
                          <div className="font-semibold text-white">{n.title}</div>
                          <div className="text-zinc-400 mt-0.5">{n.message}</div>
                          <div className="text-[10px] font-mono text-zinc-500 mt-1">{n.createdAtWib}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <AttendanceCalendar
                records={attendanceList}
                monthKey={calendarMonth}
                onMonthChange={setCalendarMonth}
              />
            </div>
          )}

          {/* 2. ABSEN MASUK & 3. ABSEN PULANG */}
          {(activeTab === 'check_in' || activeTab === 'check_out') && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#121216] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-[#F6E08B]">
                      {activeTab === 'check_in' ? 'Absensi Masuk (Wajah & GPS)' : 'Absensi Pulang (Wajah & GPS)'}
                    </h2>
                    <p className="text-xs text-zinc-400 mt-1">
                      Kamera depan akan terbuka secara langsung untuk verifikasi wajah hidup. Foto galeri tidak diperbolehkan.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCameraMode(activeTab)}
                    disabled={
                      activeTab === 'check_in'
                        ? Boolean(todayAttendance?.checkInTime && !todayAttendance?.reClockInApproved)
                        : Boolean(!todayAttendance?.checkInTime || (todayAttendance?.checkOutTime && !todayAttendance?.reClockInApproved))
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] px-5 py-3 text-sm font-bold text-[#0B0B0D] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[48px]"
                  >
                    <Camera className="w-4 h-4" />
                    <span>{activeTab === 'check_in' ? 'ABSEN MASUK SEKARANG' : 'ABSEN PULANG SEKARANG'}</span>
                  </button>
                </div>

                {todayAttendance && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-4 space-y-2">
                      <div className="text-xs font-bold text-[#F6E08B]">Bukti Absen Masuk</div>
                      {todayAttendance.checkInPhoto ? (
                        <img
                          src={todayAttendance.checkInPhoto}
                          alt="Foto Absen Masuk"
                          className="w-full h-44 object-cover rounded-xl border border-zinc-700"
                        />
                      ) : (
                        <div className="h-44 rounded-xl bg-zinc-900 flex items-center justify-center text-xs text-zinc-500">
                          Belum absen masuk
                        </div>
                      )}
                      <div className="text-xs text-zinc-300 font-mono">
                        Waktu: {todayAttendance.checkInTime || '-'} WIB
                      </div>
                      <div className="text-xs text-zinc-400">
                        {todayAttendance.checkInAddress || '-'}
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-[#18181D] p-4 space-y-2">
                      <div className="text-xs font-bold text-[#F6E08B]">Bukti Absen Pulang</div>
                      {todayAttendance.checkOutPhoto ? (
                        <img
                          src={todayAttendance.checkOutPhoto}
                          alt="Foto Absen Pulang"
                          className="w-full h-44 object-cover rounded-xl border border-zinc-700"
                        />
                      ) : (
                        <div className="h-44 rounded-xl bg-zinc-900 flex items-center justify-center text-xs text-zinc-500">
                          Belum absen pulang
                        </div>
                      )}
                      <div className="text-xs text-zinc-300 font-mono">
                        Waktu: {todayAttendance.checkOutTime || '-'} WIB
                      </div>
                      <div className="text-xs text-zinc-400">
                        {todayAttendance.checkOutAddress || '-'}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-4 space-y-3">
                <h3 className="text-sm font-bold text-[#F6E08B]">Peta Lokasi Absensi Hari Ini</h3>
                <GoogleMapViewer markers={todayMapMarkers} heightClass="h-[320px]" />
              </div>
            </div>
          )}

          {/* 4. TRACKER PERJALANAN */}
          {activeTab === 'tracker' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#121216] p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-[#F6E08B]">TRACKER PERJALANAN</h2>
                    <p className="text-xs text-zinc-400 mt-1">
                      Pelacakan lokasi bersifat transparan, hanya aktif saat Anda menjalankan tugas perusahaan dan menekan tombol mulai.
                    </p>
                  </div>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                      activeTrip
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {activeTrip ? 'TRACKER AKTIF' : 'NONAKTIF'}
                  </span>
                </div>

                {trackerError && (
                  <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{trackerError}</span>
                  </div>
                )}

                {!activeTrip ? (
                  <form onSubmit={handleStartTrip} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                        Tujuan / Tugas Perjalanan Perusahaan
                      </label>
                      <input
                        type="text"
                        value={tripPurpose}
                        onChange={(e) => setTripPurpose(e.target.value)}
                        placeholder="Contoh: Pengantaran Unit Innova ke Bandara Soekarno-Hatta"
                        className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4AF37] focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={trackerBusy}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] px-6 py-3 text-sm font-bold text-[#0B0B0D] disabled:opacity-50 cursor-pointer min-h-[48px]"
                    >
                      <Navigation className="w-4 h-4" />
                      <span>{trackerBusy ? 'Mengaktifkan GPS...' : 'Mulai Tracker Perjalanan'}</span>
                    </button>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-xl bg-[#18181D] border border-zinc-800 p-3">
                        <span className="text-zinc-400 block">Jam Mulai</span>
                        <span className="font-mono font-bold text-white">{activeTrip.startTimeWib} WIB</span>
                      </div>
                      <div className="rounded-xl bg-[#18181D] border border-zinc-800 p-3">
                        <span className="text-zinc-400 block">Jarak Tempuh</span>
                        <span className="font-mono font-bold text-[#F6E08B]">{activeTrip.distanceKm} km</span>
                      </div>
                      <div className="rounded-xl bg-[#18181D] border border-zinc-800 p-3">
                        <span className="text-zinc-400 block">Titik Koordinat</span>
                        <span className="font-mono font-bold text-white">{activeTrip.pointsCount} titik</span>
                      </div>
                      <div className="rounded-xl bg-[#18181D] border border-zinc-800 p-3">
                        <span className="text-zinc-400 block">Titik Awal</span>
                        <span className="text-zinc-200 truncate block">{activeTrip.startAddress || '-'}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleStopTrip}
                      disabled={trackerBusy}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-6 py-3 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50 cursor-pointer min-h-[48px]"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{trackerBusy ? 'Menghentikan...' : 'Hentikan Tracker (Tugas Selesai)'}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-4 space-y-3">
                <h3 className="text-sm font-bold text-[#F6E08B]">Peta Jalur Perjalanan Realtime</h3>
                <GoogleMapViewer
                  markers={activeTripMarkers}
                  routePoints={activeTrip?.points || []}
                  heightClass="h-[360px]"
                />
              </div>
            </div>
          )}

          {/* 5. PENGAJUAN IZIN / SAKIT */}
          {activeTab === 'leave' && (
            <div className="space-y-6">
              <form
                onSubmit={handleSubmitLeave}
                className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4"
              >
                <h2 className="text-lg font-bold text-[#F6E08B]">Pengajuan Izin, Sakit & Cuti</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Nama Pegawai (Otomatis)</label>
                    <input
                      type="text"
                      value={employee.fullName}
                      disabled
                      className="w-full rounded-xl border border-zinc-800 bg-[#0E0E12] px-4 py-2.5 text-sm text-zinc-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-300 mb-1">Jenis Pengajuan</label>
                    <select
                      value={leaveType}
                      onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                      className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-4 py-2.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                    >
                      {Object.entries(LEAVE_LABELS).map(([k, lbl]) => (
                        <option key={k} value={k}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-300 mb-1">Tanggal Mulai</label>
                    <input
                      type="date"
                      value={leaveStart}
                      onChange={(e) => setLeaveStart(e.target.value)}
                      className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-4 py-2.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-300 mb-1">Tanggal Selesai</label>
                    <input
                      type="date"
                      value={leaveEnd}
                      onChange={(e) => setLeaveEnd(e.target.value)}
                      className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-4 py-2.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Alasan / Keterangan</label>
                  <textarea
                    rows={3}
                    value={leaveReason}
                    onChange={(e) => setLeaveReason(e.target.value)}
                    placeholder="Jelaskan alasan pengajuan izin, sakit, atau keperluan mendesak..."
                    className="w-full rounded-xl border border-zinc-800 bg-[#18181D] px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300 mb-1.5">
                    Unggah Foto Bukti / Surat Dokter (JPG, PNG, atau PDF maks. 480 KB)
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-[#18181D] p-3.5 text-xs text-zinc-300 cursor-pointer hover:border-[#D4AF37]">
                    <Upload className="w-4 h-4 text-[#D4AF37]" />
                    <span>{attachmentName || 'Pilih file foto atau PDF surat dokter...'}</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={submittingLeave}
                  className="w-full sm:w-auto rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B58E24] px-6 py-3 text-sm font-bold text-[#0B0B0D] disabled:opacity-50 cursor-pointer min-h-[48px]"
                >
                  {submittingLeave ? 'Mengirim...' : 'KIRIM PENGAJUAN'}
                </button>
              </form>

              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-3">
                <h3 className="text-sm font-bold text-[#F6E08B]">Riwayat Pengajuan Saya</h3>
                {leaves.length === 0 ? (
                  <p className="text-xs text-zinc-400">Belum ada pengajuan izin atau sakit.</p>
                ) : (
                  <div className="space-y-2.5">
                    {leaves.map((lv) => (
                      <div key={lv.id} className="rounded-xl border border-zinc-800 bg-[#18181D] p-3.5 text-xs space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white">{LEAVE_LABELS[lv.type]}</span>
                          <span
                            className={`font-semibold uppercase ${
                              lv.status === 'approved'
                                ? 'text-emerald-400'
                                : lv.status === 'rejected'
                                ? 'text-red-400'
                                : 'text-amber-300'
                            }`}
                          >
                            {lv.status === 'approved'
                              ? 'Disetujui'
                              : lv.status === 'rejected'
                              ? 'Ditolak'
                              : 'Menunggu Persetujuan'}
                          </span>
                        </div>
                        <div className="font-mono text-zinc-400">
                          {lv.startDate} s/d {lv.endDate}
                        </div>
                        <p className="text-zinc-300">{lv.reason}</p>
                        {lv.adminNote && (
                          <div className="text-zinc-200 bg-black/40 rounded-lg p-2 border border-zinc-800">
                            Catatan Admin: {lv.adminNote}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. RIWAYAT ABSENSI */}
          {activeTab === 'history_attendance' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
                <h2 className="text-lg font-bold text-[#F6E08B]">Riwayat Absensi Saya</h2>
                {attendanceList.length === 0 ? (
                  <p className="text-xs text-zinc-400">Belum ada riwayat absensi tercatat.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-zinc-800 text-zinc-400">
                        <tr>
                          <th className="py-2.5 pr-3">Tanggal</th>
                          <th className="py-2.5 pr-3">Masuk</th>
                          <th className="py-2.5 pr-3">Pulang</th>
                          <th className="py-2.5 pr-3">Kerja Bersih</th>
                          <th className="py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/70">
                        {attendanceList.map((a) => (
                          <tr key={a.id} className="hover:bg-zinc-900/50">
                            <td className="py-3 pr-3 font-mono text-white">{a.dateWib}</td>
                            <td className="py-3 pr-3 font-mono text-zinc-300">{a.checkInTime || '-'}</td>
                            <td className="py-3 pr-3 font-mono text-zinc-300">{a.checkOutTime || '-'}</td>
                            <td className="py-3 pr-3 font-mono text-[#F6E08B]">
                              {formatMinutesToDuration(a.netWorkMinutes ?? a.workMinutes)}
                            </td>
                            <td className="py-3 uppercase font-semibold text-zinc-200">
                              {a.status.replace('_', ' ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <AttendanceCalendar
                records={attendanceList}
                monthKey={calendarMonth}
                onMonthChange={setCalendarMonth}
              />
            </div>
          )}

          {/* 7. RIWAYAT PERJALANAN */}
          {activeTab === 'history_trips' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
                <h2 className="text-lg font-bold text-[#F6E08B]">Riwayat Perjalanan Dinas</h2>
                {trips.length === 0 ? (
                  <p className="text-xs text-zinc-400">Belum ada riwayat perjalanan tercatat.</p>
                ) : (
                  <div className="space-y-3">
                    {trips.map((tr) => (
                      <div key={tr.id} className="rounded-xl border border-zinc-800 bg-[#18181D] p-4 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white">{tr.purpose}</span>
                          <span className="font-mono text-[#F6E08B]">{tr.distanceKm} km</span>
                        </div>
                        <div className="font-mono text-zinc-400">
                          {tr.dateWib} · {tr.startTimeWib} s/d {tr.endTimeWib || 'Aktif'} WIB
                        </div>
                        <div className="text-zinc-400">
                          Dari: {tr.startAddress || `${tr.startLat.toFixed(4)}, ${tr.startLng.toFixed(4)}`}
                        </div>
                        {tr.endAddress && (
                          <div className="text-zinc-400">Tujuan Akhir: {tr.endAddress}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 8. PROFIL SAYA */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {employee.photoUrl ? (
                    <img
                      src={employee.photoUrl}
                      alt={employee.fullName}
                      className="h-16 w-16 rounded-2xl object-cover border border-[#D4AF37]/40"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-2xl bg-[#18181D] border border-zinc-700 flex items-center justify-center text-[#D4AF37] font-bold text-xl">
                      {employee.fullName.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h2 className="text-lg font-bold text-white">{employee.fullName}</h2>
                    <div className="text-xs text-zinc-400">
                      {employee.employeeCode} · @{employee.username} · {employee.position}
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">HP: {employee.phone}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setCameraMode('enroll')}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2.5 text-xs font-bold text-[#0B0B0D] cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>{employee.faceEnrolled ? 'Perbarui Data Wajah' : 'Daftarkan Wajah'}</span>
                </button>
              </div>

              <form
                onSubmit={handleChangePassword}
                className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4"
              >
                <h3 className="text-sm font-bold text-[#F6E08B] flex items-center gap-2">
                  <KeyRound className="w-4 h-4" />
                  <span>Ubah Kata Sandi Pegawai</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="Kata sandi lama"
                    className="rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
                  />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Kata sandi baru (min. 6)"
                    className="rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Konfirmasi kata sandi baru"
                    className="rounded-xl border border-zinc-800 bg-[#18181D] px-3.5 py-2.5 text-sm text-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={changingPass}
                  className="rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/15 px-5 py-2.5 text-xs font-bold text-[#F6E08B] hover:bg-[#D4AF37]/25 cursor-pointer"
                >
                  {changingPass ? 'Menyimpan...' : 'Simpan Kata Sandi Baru'}
                </button>
              </form>
            </div>
          )}

          {/* 9. PENGATURAN */}
          {activeTab === 'settings' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-[#121216] p-5 space-y-4">
                <h2 className="text-lg font-bold text-[#F6E08B] flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" />
                  <span>Pengaturan & Privasi Data Pegawai</span>
                </h2>
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                  {settings.privacyPolicyText || DEFAULT_PRIVACY_POLICY}
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <PWAInstallButton />
                  <button
                    type="button"
                    onClick={async () => {
                      await sendAdminNotification(
                        'system',
                        'Permintaan Penghapusan Data',
                        `${employee.fullName} mengajukan peninjauan/penghapusan data pribadi sesuai kebijakan perusahaan.`
                      );
                      showToast('success', 'Permintaan peninjauan/penghapusan data telah dikirim ke Direktur/Admin.');
                    }}
                    className="rounded-xl border border-zinc-700 bg-[#18181D] px-4 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                  >
                    Ajukan Penghapusan Data Biometrik
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar (Thumb Zone) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-[#101014]/95 backdrop-blur-md grid grid-cols-5 h-16 pb-safe">
        {[
          { id: 'dashboard' as const, label: 'Beranda', icon: <LayoutDashboard className="w-5 h-5" /> },
          { id: 'check_in' as const, label: 'Masuk', icon: <LogIn className="w-5 h-5" /> },
          { id: 'check_out' as const, label: 'Pulang', icon: <LogOut className="w-5 h-5" /> },
          { id: 'tracker' as const, label: 'Tracker', icon: <Navigation className="w-5 h-5" /> },
          { id: 'leave' as const, label: 'Izin', icon: <FileText className="w-5 h-5" /> },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold cursor-pointer ${
              activeTab === item.id ? 'text-[#D4AF37]' : 'text-zinc-400'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Mobile Full Navigation Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 bg-[#101014] border-r border-zinc-800 p-4 flex flex-col justify-between h-full">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-extrabold text-[#F6E08B]">MENU PEGAWAI</span>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-2 text-zinc-400 hover:text-white cursor-pointer"
                >
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
                      setMobileDrawerOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-xs font-semibold cursor-pointer ${
                      activeTab === item.id ? 'bg-[#D4AF37] text-[#0B0B0D]' : 'text-zinc-300'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 py-3 text-xs font-bold text-red-300 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
          <div className="flex-1 bg-black/70" onClick={() => setMobileDrawerOpen(false)} />
        </div>
      )}

      {/* Live Face & GPS Camera Modal */}
      {cameraMode && (
        <FaceCameraModal
          title={
            cameraMode === 'check_in'
              ? 'Verifikasi Wajah — Absen Masuk'
              : cameraMode === 'check_out'
              ? 'Verifikasi Wajah — Absen Pulang'
              : 'Pendaftaran Data Wajah Biometrik'
          }
          subtitle={`${employee.fullName} · ${employee.employeeCode}`}
          employeeName={employee.fullName}
          enrolledSignature={employee.faceSignature}
          requireGps={cameraMode !== 'enroll'}
          onClose={() => setCameraMode(null)}
          onVerified={handleCameraVerified}
        />
      )}
    </div>
  );
};
