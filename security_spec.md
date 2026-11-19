# Security Specification — REY RENT CAR Attendance & Tracking System

## 1. Data Invariants
1. **Master Gate & Zero Blanket Reads**: Tidak ada koleksi yang boleh dibaca publik (`allow read: if true`) atau menggunakan blanket `allow list: if isSignedIn();`. Semua koleksi mewajibkan `email_verified == true` dan pemeriksaan `isAdmin()` atau `resource.data.uid == request.auth.uid` / `linkedUid == request.auth.uid`.
2. **PII & Biometric Isolation**: Data pribadi pegawai (`phone`, `email`, `faceSignature`, `photoUrl`), foto bukti absensi, dan dokumen surat dokter pada `leaveRequests` hanya dapat diakses oleh Direktur/Admin atau pemilik data itu sendiri.
3. **Anti-Tampering Timestamps**: Field `createdAt` dan `updatedAt` wajib menggunakan waktu server (`request.time`), mencegah pegawai memanipulasi jam perangkat HP.
4. **Role Escalation Guard**: Pengguna tidak dapat menetapkan dirinya sebagai `admin` atau mengubah `employeeId`/`role` pada dokumen `users/{userId}` kecuali diverifikasi oleh Admin atau saat proses klaim profil pegawai yang belum tertaut.
5. **Terminal State Locking**: Pengajuan izin (`leaveRequests`) yang sudah berstatus `approved` atau `rejected` tidak dapat diubah lagi oleh pegawai; hanya Admin yang dapat meninjau atau mengubahnya.
6. **Payload & Array Bounds**: Semua string wajib dibatasi dengan `.size()` dan semua array (`faceSignature` <= 64, `points` <= 250) dibatasi ukurannya.

## 2. "Dirty Dozen" Adversarial Payloads (Harus Ditolak `PERMISSION_DENIED`)
1. **Unauthenticated Read**: `GET /attendance/att-1` tanpa auth -> DITOLAK.
2. **Unverified Email Admin Spoof**: `GET /employees/EMP-001` dengan `email: 'sobarihartono@gmail.com'` tetapi `email_verified: false` -> DITOLAK.
3. **Privilege Escalation via Users**: Pegawai mencoba `CREATE /users/{uid}` dengan `role: 'admin'` -> DITOLAK.
4. **Cross-Employee Attendance Read**: Pegawai A mencoba `GET /attendance/att-pegawai-B` -> DITOLAK.
5. **Blanket List Scraping**: Pegawai A mencoba `LIST /attendance` tanpa filter `where('uid', '==', auth.uid)` -> DITOLAK.
6. **Shadow Field Injection**: Pegawai mengirim `CREATE /attendance/att-1` dengan field tambahan `isHack: true` -> DITOLAK (`hasOnly`).
7. **Timestamp Spoofing**: Pegawai mengirim `CREATE /attendance/att-1` dengan `createdAt` waktu kemarin bukan `request.time` -> DITOLAK.
8. **Self-Approving Leave Request**: Pegawai mengirim `CREATE /leaveRequests/req-1` dengan `status: 'approved'` -> DITOLAK.
9. **Modifying Approved Leave**: Pegawai mencoba `UPDATE /leaveRequests/req-1` yang sudah berstatus `'approved'` -> DITOLAK.
10. **Self-Approving Overtime**: Pegawai mencoba `UPDATE /attendance/att-1` dengan `overtimeApproved: true` -> DITOLAK.
11. **Oversized ID Poisoning**: Membuat dokumen dengan ID sepanjang 500 karakter atau mengandung `/` / spasi -> DITOLAK (`isValidId`).
12. **Unbounded Array Bomb**: Mengirim `trackingHistory` dengan array `points` lebih dari 250 item -> DITOLAK.
