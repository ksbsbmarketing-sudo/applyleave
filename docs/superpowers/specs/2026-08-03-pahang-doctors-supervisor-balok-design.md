# Semua Doktor Pahang → Supervisor Balok (Peringkat 1)

**Tarikh:** 2026-08-03
**Status:** Design — menunggu semakan pengguna

## Masalah

Peraturan routing `doctor_pahang` mengecualikan dua cawangan: **Klinik Syed Badaruddin MCKIP** dan **Uni Klinik Bentong**. Doktor di dua cawangan itu jatuh ke kumpulan `pahang_lain`, yang meletakkan **Doctor PIC cawangan sendiri** sebagai pelulus Peringkat 1.

Ini gagal apabila Doctor PIC itu sendiri yang memohon, atau apabila jawatan itu kosong:

| Pemohon | Pelulus P1 hari ini | Kenapa gagal |
|---|---|---|
| DR TIPA A/P KUPPUSAMY (doctor_pic, MCKIP) | *kosong* | Calon P1 buang diri sendiri (`s.ic !== staffMember.ic`) — dia satu-satunya PIC MCKIP |
| Doktor Uni Klinik Bentong | *kosong* | Tiada `doctor_pic` didaftarkan di Bentong langsung |

Bila senarai P1 kosong, borang melangkau dropdown pelulus (`src/main.js:5700`) dan rekod duduk `PENDING` sehingga HR luluskan terus. Rekod itu **tidak** ditanda `directHR`, jadi peringatan cuti tertangguh (butang WA manual dan cron harian Vercel) mendapat **senarai penerima kosong** — tiada sesiapa dikejutkan.

## Keputusan

Doktor di **semua** cawangan Pahang mendapat sokongan **Supervisor Balok (HQ)** di Peringkat 1, kemudian **HR/Admin** di Peringkat 2. Pengecualian MCKIP dan Bentong dibuang sepenuhnya.

Staf bukan-doktor tidak berubah: staf operasi MCKIP & Bentong kekal di bawah Doctor PIC cawangan masing-masing, doktor Terengganu kekal di bawah PIC cawangan sendiri (satu peringkat).

## Perubahan

### 1. Peraturan routing (teras)

`src/main.js:1685-1690` dan `otp-backend/lib/routing.js:43-48` — buang kedua-dua syarat pengecualian:

```js
// sebelum
if (s.category === 'Doctor' && branchObj && branchObj.state === 'Pahang'
    && branchObj.daerah !== 'Bentong'
    && s.branch !== 'Klinik Syed Badaruddin MCKIP') return 'doctor_pahang';

// selepas
if (s.category === 'Doctor' && branchObj && branchObj.state === 'Pahang') return 'doctor_pahang';
```

Kedua-dua fail **mesti** diubah serentak — `routing.js` ialah port yang digunakan oleh cron peringatan; kalau tersasar, peringatan akan tuju kepada pelulus yang berlainan daripada yang app tunjuk.

Tiada kumpulan routing baharu dan tiada perubahan pada `config/approvalRouting`. Kumpulan `doctor_pahang` sedia ada (`p1_supervisor: true`, `needs_p2: true`) sudah memberi aliran yang dikehendaki.

### 2. Paparan aliran kelulusan

- `src/main.js:7236-7258` — buang cabang `isBentong` dan `isMCKIP` daripada blok `isDoctor`; nota jadi "Doktor Pahang mesti mendapat sokongan Supervisor Balok terlebih dahulu." Cabang Terengganu kekal.
- `src/main.js:7502-7509` — jadi `if (isPahang) step1Who = 'Supervisor Balok';`.

### 3. Label UI Laluan Kelulusan / RBAC

`src/main.js:9595`, `9641`, `9721`, `10352` — sub-label `Pahang (Selain Bentong)` jadi `Pahang (Semua Cawangan)`.

### 4. Ujian

`otp-backend/lib/routing.test.js`:
- Ubah ujian sedia ada "Pahang doctor at MCKIP → pahang_lain" jadi `doctor_pahang`.
- Tambah: doktor Bentong → `doctor_pahang`.
- Tambah: `doctor_pic` MCKIP memohon → P1 = supervisor Balok HQ (bukan kosong).
- Tambah (regresi): Operation Staff MCKIP kekal `pahang_lain` dengan P1 = Doctor PIC MCKIP.

Jalankan: `cd otp-backend && npm test`.

### 5. Penjana dokumen

- `generate_carta_pelulus.cjs:73` — salinan logik `getStaffGroup`; mesti ikut perubahan yang sama, kalau tidak carta bercanggah dengan sistem. Teks di baris 149, 152, 400 dikemas kini.
- `generate_manual_pdf.cjs:780-781`, `931-932`, `1401`, `1629` dan `generate_manual_word.cjs:333-334` — teks statik "kecuali MCKIP & Bentong" dikemas kini.

Fail output (PDF/Word) **tidak** dijana semula dalam kerja ini — penjanaan manual memerlukan log masuk puppeteer langsung; ia kerja berasingan bila HR perlukan salinan baharu.

## Kesan pada staf sebenar

| Staf | Sebelum | Selepas |
|---|---|---|
| DR TIPA A/P KUPPUSAMY (doctor_pic, MCKIP) | tiada P1 → HR terus | Supervisor Balok → HR |
| DR MUHAMMAD HANIFF ASYRAF (hod_cawangan, Doctor, MCKIP) | P1 = Dr Tipa | Supervisor Balok → HR |
| Doktor Bentong | *tiada doktor berdaftar* | Supervisor Balok → HR (bila didaftarkan) |
| 3 staf operasi MCKIP | P1 = Dr Tipa | tidak berubah |
| 3 staf operasi Bentong | tiada P1 → HR terus | tidak berubah (lubang berasingan — lihat "Di luar skop") |
| Doktor Pahang lain, Balok, Terengganu | — | tidak berubah |

Supervisor Balok (HQ) yang aktif sekarang: **HASIMAH BINTI MOHAMAD**.

Kesan ikutan yang sudah betul tanpa kod tambahan:
- `canManage` (`src/main.js:1144-1147`) — `doctor_pahang` ada dalam senarai `useBalok`, jadi Supervisor Balok layak urus rekod ini.
- Dr Tipa berhenti menjadi pelulus doktor MCKIP kerana `cfg.p1_doctor_pic` adalah `false` bagi `doctor_pahang`.
- Peringatan WA dan cron kini jumpa Supervisor Balok sebagai penerima.

## Migrasi

Tiada. Semakan `data/leaves.json` menunjukkan **0 rekod terbuka** (PENDING / TL APPROVED / HOD APPROVED) milik doktor MCKIP, dan **0 rekod langsung** milik staf Bentong. Routing dikira secara langsung, jadi tiada rekod tergantung yang bertukar pelulus di tengah jalan. Rekod yang mempunyai `hodIC` tersimpan tetap terkunci kepada pelulus asal (`src/main.js:1121`).

## Risiko

- **Config Firestore menimpa kod.** `config/approvalRouting` menimpa `ROUTING_DEFAULTS` semasa larian. Jika `doctor_pahang.p1_supervisor` pernah dimatikan dari skrin Laluan Kelulusan, doktor MCKIP/Bentong akan berakhir tanpa P1 semula. Sahkan nilai langsung selepas deploy.
- **Titik kegagalan tunggal.** Semua doktor Pahang kini bergantung kepada satu Supervisor Balok yang aktif. Jika jawatan itu kosong atau ditanda `inactive`, semua doktor Pahang hilang P1 serentak.

## Di luar skop

- **3 staf operasi Uni Klinik Bentong masih tiada pelulus P1** — mereka perlukan Doctor PIC yang didaftarkan di Bentong (kerja pentadbiran, bukan kod), atau keputusan berasingan untuk mengalihkan staf operasi cawangan tanpa PIC kepada pelulus lain.
- Fallback am "bila P1 kosong → HR" dengan penanda `directHR` supaya peringatan automatik tidak senyap. Elok ada, tetapi mengubah tingkah laku cawangan Terengganu juga; nilaikan berasingan.
