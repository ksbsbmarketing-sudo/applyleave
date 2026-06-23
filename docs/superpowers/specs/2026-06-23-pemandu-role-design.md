# Reka Bentuk: Role Baru "Pemandu" (Driver)

Tarikh: 2026-06-23

## Ringkasan

Tambah satu role baru `pemandu` ke dalam sistem cuti KSB. Pemandu ialah role
**pekerja biasa** — hanya memohon cuti, tiada kuasa meluluskan permohonan orang
lain. Pemandu hanya bertugas di **Klinik Syed Badaruddin Balok (HQ)**.

Laluan kelulusan cuti pemandu (laluan khas tersendiri):

```
Pemandu  →  Supervisor (Balok HQ)  →  HR (kelulusan akhir / P2)
```

Laluan ini identik dengan laluan `juru_xray`/`sonographer`, tetapi pemandu
mendapat **group routing tersendiri** (`pemandu_balok`) supaya HR boleh
mengubah laluannya secara bebas melalui UI Routing di kemudian hari.

## Keputusan Reka Bentuk

- **Group routing tersendiri (Pilihan A).** Walaupun laluan sama dengan
  `xray_sono_balok`, group `pemandu_balok` yang berasingan diikuti corak
  `juru_audio_balok` — lebih jelas semantiknya dan memberi kawalan berasingan.
- Pemandu mewarisi profil kebenaran RBAC yang sama dengan `juru_xray` (semua
  kebenaran approver/pengurusan = `false`).

## Perubahan Kod

Semua dalam fail sedia ada:

1. **`src/main.js` — `CORE_ROLES`** (≈ baris 1001): tambah `'pemandu'`.
2. **`src/main.js` — `staffConfig.roleLabels`** (≈ baris 1004): tambah
   `pemandu: 'Pemandu'`.
3. **`src/main.js` — `rbacMatrix`** (≈ baris 935): tambah entri `pemandu`
   disalin daripada `juru_xray`. Ini juga membuatkan `pemandu` muncul dalam
   dropdown role borang staf (dropdown dibina daripada `Object.keys(rbacMatrix)`).
4. **`src/main.js` — `getStaffGroup`** (≈ baris 1649): tambah carve-out
   `if (s.role === 'pemandu' && isBalok) return 'pemandu_balok';`
   diletakkan bersama carve-out paramedik yang lain.
5. **`src/main.js` — `ROUTING_DEFAULTS`** (≈ baris 1632): tambah group
   `pemandu_balok: { needs_tl: false, p1_doctor_pic: false, p1_supervisor: true,
   p1_hod_balok: false, needs_p2: true }`.
6. **`seed-role-permissions.js`** (≈ baris 9): tambah
   `pemandu: { canApprove: false, manageStaff: false }`.

## Nota Deployment (Kritikal)

Firestore mengatasi nilai lalai kod. Selepas kod dikemas kini dan di-deploy,
dokumen Firestore live ini **juga** perlu ditambah entri baru, kalau tidak role
pemandu tidak berfungsi sepenuhnya di production:

- `settings/rbac` — tambah objek `pemandu` (salin daripada `juru_xray`).
- `config/rolePermissions` — tambah `pemandu: { canApprove: false, manageStaff: false }`
  (boleh dijana semula dengan menjalankan `seed-role-permissions.js`).
- `config/approvalRouting` — tambah group `pemandu_balok` (jika dokumen ini
  wujud dan mengatasi `ROUTING_DEFAULTS`).

## Pengesahan / Kriteria Kejayaan

- HR boleh memilih "Pemandu" sebagai role apabila menambah/mengedit staf.
- Staf pemandu di Balok HQ yang memohon cuti dirouting ke Supervisor Balok HQ
  sebagai pelulus P1, kemudian HR sebagai P2.
- Pemandu tidak nampak tab pengurusan/kelulusan (tiada kuasa approver).
- UI Routing memaparkan group `pemandu_balok` yang boleh ditogol HR.

## Di Luar Skop (YAGNI)

- Pemandu di cawangan lain selain Balok HQ.
- Sebarang kuasa kelulusan untuk pemandu.
- Ciri khusus pemandu (cth. rekod perjalanan/kenderaan) — ini sistem cuti sahaja.
