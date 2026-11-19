export type UserRole = 'admin' | 'employee';

export type EmployeeStatus = 'active' | 'inactive';

export type AttendanceStatus =
  | 'hadir'
  | 'terlambat'
  | 'belum_pulang'
  | 'pulang_cepat'
  | 'lembur'
  | 'izin'
  | 'sakit'
  | 'cuti'
  | 'alpha';

export type LeaveType =
  | 'izin_pribadi'
  | 'sakit'
  | 'cuti'
  | 'tidak_masuk'
  | 'keperluan_mendesak';

export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  employeeId?: string;
  username?: string;
  consentBiometric: boolean;
  consentLocation: boolean;
  consentAt?: string;
  updatedAt?: unknown;
}

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  username: string;
  email?: string;
  phone: string;
  position: string;
  status: EmployeeStatus;
  photoUrl?: string;
  faceEnrolled: boolean;
  faceSignature?: number[];
  linkedUid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EmployeeCredential {
  username: string;
  employeeId: string;
  passwordHash: string;
  passwordSalt: string;
  linkedUid?: string;
  mustChangePassword: boolean;
  updatedAt?: unknown;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  uid: string;
  dateWib: string; // YYYY-MM-DD
  checkInTime?: string; // HH:mm:ss
  checkInEpoch?: number;
  checkInLat?: number;
  checkInLng?: number;
  checkInAccuracy?: number;
  checkInAddress?: string;
  checkInPhoto?: string;
  checkInLivenessScore?: number;
  checkInMockSuspected?: boolean;
  checkInMockReason?: string;
  checkOutTime?: string;
  checkOutEpoch?: number;
  checkOutLat?: number;
  checkOutLng?: number;
  checkOutAccuracy?: number;
  checkOutAddress?: string;
  checkOutPhoto?: string;
  checkOutLivenessScore?: number;
  checkOutMockSuspected?: boolean;
  checkOutMockReason?: string;
  status: AttendanceStatus;
  workMinutes?: number;
  netWorkMinutes?: number;
  breakDeductedMinutes?: number;
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  overtimeMinutes?: number;
  overtimeApproved?: boolean;
  reClockInApproved?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FaceVerificationLog {
  id: string;
  employeeId: string;
  uid: string;
  actionType: 'enroll' | 'check_in' | 'check_out';
  livenessPassed: boolean;
  challengePrompt?: string;
  similarityScore: number;
  photoData?: string;
  timestampWib: string;
  createdAt?: unknown;
}

export interface EmployeeLocation {
  employeeId: string;
  employeeName: string;
  uid: string;
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  address?: string;
  isTracking: boolean;
  isOnline: boolean;
  activeTripId?: string;
  mockSuspected?: boolean;
  lastUpdatedWib: string;
  updatedAt?: unknown;
}

export interface TrackingPoint {
  lat: number;
  lng: number;
  ts: number;
  wibTime: string;
  accuracy?: number;
}

export interface TrackingTrip {
  id: string;
  employeeId: string;
  employeeName: string;
  uid: string;
  dateWib: string;
  purpose: string;
  status: 'active' | 'completed' | 'interrupted';
  startTimeWib: string;
  endTimeWib?: string;
  startLat: number;
  startLng: number;
  startAddress?: string;
  endLat?: number;
  endLng?: number;
  endAddress?: string;
  distanceKm: number;
  pointsCount: number;
  points: TrackingPoint[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  uid: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentData?: string;
  status: LeaveStatus;
  adminNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WorkSchedule {
  id: string;
  name: string;
  startTime: string; // "08:00"
  endTime: string; // "17:00"
  lateToleranceMinutes: number;
  breakMinutes: number;
  breakThresholdHours: number;
  overtimeMinMinutes: number;
  requireOvertimeApproval: boolean;
  timezone: string;
  updatedAt?: unknown;
}

export interface AppNotification {
  id: string;
  targetRole: 'admin' | 'employee';
  targetEmployeeId?: string;
  uid: string;
  category: 'check_in' | 'check_out' | 'late' | 'leave' | 'tracking' | 'gps_alert' | 'system';
  title: string;
  message: string;
  isRead: boolean;
  createdAtWib: string;
  createdAt?: unknown;
}

export interface MonthlyReport {
  id: string;
  monthKey: string; // YYYY-MM
  generatedBy: string;
  totalEmployees: number;
  attendanceRate: number;
  totalHours: number;
  summaryText?: string;
  createdAt?: unknown;
}

export interface AdminSettings {
  id: string;
  companyName: string;
  tagline: string;
  timezone: string;
  privacyPolicyText: string;
  dataRetentionDays: number;
  allowMockLocation: boolean;
  requireConsent: boolean;
  updatedAt?: unknown;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail?: string;
  actorRole: 'admin' | 'employee';
  action: string;
  targetCollection: string;
  targetId: string;
  details: string;
  timestampWib: string;
  createdAt?: unknown;
}
