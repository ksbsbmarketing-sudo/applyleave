# Reka Bentuk: Label Jenis Cuti Diselaraskan + Cuti Ganti (Doktor)

Tarikh: 2026-08-05

## Masalah

Tiga perkara yang mengelirukan HR dan staf hari ini:

1. **`EL_EMG` bocor ke antara muka.** Kod simpanan mentah terpapar dalam tajuk lajur
   Analisa, dropdown laporan Baki, dan kad "Baki Cuti Lain" (`Kecemasan Am (EL_EMG)`).
   Namanya pula, `Emergency (Non-Ehsan)`, bercampur Inggeris–Melayu dan tidak sepadan
   dengan label yang dicetak dalam laporan.
2. **`ML_PL` sama masalahnya** — awalan `ML_` adalah butiran teknikal (ia dahulu
   diperoleh daripada Maternity Leave), bukan sesuatu yang staf perlu baca.
3. **Management Hub melabel medan `ent-EL_EMG` sebagai "EL"**, sedangkan `EL` ialah
   jenis cuti yang berlainan (Cuti Ehsan, 3 hari, Formula B) yang mempunyai bloknya
   sendiri lebih atas dalam modal yang sama. HR yang mengisi medan bertanda "EL" itu
   sebenarnya sedang menetapkan kelayakan Cuti Kecemasan.

Selain itu, doktor memerlukan satu jenis cuti baru: **Cuti Ganti**, iaitu cuti gantian
selepas menghadiri mesyuarat doktor. Ia tiada tempat dalam sistem sekarang.

## Keputusan reka bentuk

### Kod simpanan tidak berubah

`EL_EMG` dan `ML_PL` kekal sebagai `id` dalam `leaveCategories` dan sebagai nilai
`record.type` dalam Firestore. Medan staf yang berkaitan (`el_used_pre`,
`el_used_sys_adj`, `el_pelarasan`, `ent_EL_EMG`, `ent_PL`) tidak disentuh.

Sebabnya: menukar kod bermakna migrasi setiap rekod cuti bersejarah dan setiap medan
staf. Satu rekod terlepas akan hilang senyap daripada laporan. Kekeliruan yang hendak
diselesaikan adalah kekeliruan *pembacaan*, jadi penyelesaiannya di lapisan paparan.

### EL kekal "Ehsan", EL_EMG kekal "Kecemasan"

Laporan cetak sudah pun melabel keduanya begini melalui `leaveReportLabel()`
(`src/main.js:2877`). Reka bentuk ini menjadikan label tersebut konsisten di
**seluruh** aplikasi dan membuang `leaveReportLabel()` sebagai tampalan khas laporan.

| Kod simpanan | Nama penuh (baru)   | Kod pendek dipapar (baru) |
| ------------ | ------------------- | ------------------------- |
| `EL`         | Cuti Ehsan          | `EL`                      |
| `EL_EMG`     | Cuti Kecemasan      | `EMG`                     |
| `ML_PL`      | Cuti Paterniti (PL) | `PL`                      |

`EMG` dipilih untuk `EL_EMG` kerana memendekkannya kepada `EL` akan bertindih dengan
Cuti Ehsan dalam jadual bersebelahan lajur.

### Cuti Ganti = jenis baru `RL`

- **Kod:** `RL`. **Nama:** `Cuti Ganti`. **Warna:** `#14b8a6` (teal).
  Glosari polisi dalam aplikasi sudah pun menyenaraikan
  `RL — Replacement Leave (Cuti Ganti)` (`src/main.js:530`) walaupun jenis cuti itu
  tidak pernah wujud. Menggunakan `RL` menjadikan kod itu benar, bukan menambah kod
  ketiga untuk konsep yang sama.
- **Doktor sahaja, tambah `super_admin`.** Ditapis dalam borang mohon dengan
  `user.category === 'Doctor' || user.role === 'super_admin'`, mengikut corak yang sama
  seperti CME ditapis dalam modal Management Hub. `super_admin` disertakan atas
  permintaan pengguna supaya jenis cuti ini kelihatan wujud dari akaun pentadbir tanpa
  perlu meminjam akaun doktor untuk menyemaknya.
- **Tiada kuota tetap.** `entitlement: 0`, dan `RL` **tidak** ditambah ke
  `FORMULA_B_TYPES`. Cuti ganti diperoleh selepas mesyuarat, bukan diperuntukkan awal
  tahun, jadi tiada baki untuk dihabiskan. Hari yang diambil direkod dan muncul dalam
  semua laporan penggunaan.
- **Tiada medan Management Hub.** Kerana tiada kuota, HR tiada apa untuk ditetapkan.
  `RL` tidak muncul dalam tatasusunan `leaveTypes` di `src/main.js:5121` dan tiada
  input `ent-RL`.
- **Hari bekerja**, bukan hari kalendar — `RL` tidak ditambah ke
  `CALENDAR_DAY_LEAVE_TYPES`.
- **Laluan kelulusan biasa.** Tiada pengecualian `shouldSkipP1`, tiada muat naik bukti
  diwajibkan.
- **Dikecualikan daripada polisi notis awal.** `RL` ditambah ke `_noticeExempt`
  (`src/main.js:4893`) dan `isNoticeExempt` (`src/main.js:6049`), sejajar dengan CME.
  Tanpa ini, polisi 7-hari-notis untuk staf bukan-Admin akan menolak setiap permohonan
  Cuti Ganti, kerana cuti ini sememangnya dituntut *selepas* mesyuarat berlangsung.
- **Nota pada borang:** "Cuti ganti selepas menghadiri mesyuarat doktor."

## Seni bina

Katalog jenis cuti berpindah keluar dari `src/main.js` ke modul tulen baru
**`src/leaveTypes.js`**, mengikut corak yang sudah wujud dalam repo ini
(`leaveDays.js`, `leaveBalance.js`, `nameFormat.js`, `phoneFormat.js`,
`loginBranches.js`). Sebabnya praktikal: `main.js` mengimport `style.css`, Firebase dan
Chart.js, jadi apa-apa di dalamnya tidak boleh diuji dengan `node --test`. Ujian
keunikan yang diperlukan bahagian Ujian di bawah hanya mungkin jika data ini tulen.

```js
// src/leaveTypes.js — katalog jenis cuti + label paparan. Tiada Firebase/DOM.
export const LEAVE_CATEGORIES = Object.freeze([ /* … 10 entri … */ ]);

// Nama penuh — diterbitkan daripada LEAVE_CATEGORIES, ditambah kod warisan.
export const LEAVE_TYPE_NAMES = { …, PL: 'Cuti Paterniti (PL)', CF: 'Cuti Bawa Ke Hadapan (CF)' };
export function leaveTypeName(code) { return LEAVE_TYPE_NAMES[code] || code; }

// Kod pendek untuk tajuk lajur/cip. Kod simpanan (EL_EMG, ML_PL) kekal dalam
// Firestore; hanya apa yang dibaca pengguna berubah. Kod tanpa entri di sini
// dipaparkan sebagaimana adanya.
export const LEAVE_TYPE_SHORT = Object.freeze({ EL_EMG: 'EMG', ML_PL: 'PL' });
export function leaveTypeShort(code) { return LEAVE_TYPE_SHORT[code] || code; }
```

`src/main.js` mengimport modul ini dan mengekalkan `const leaveCategories =
LEAVE_CATEGORIES;` supaya ~15 tapak panggilan sedia ada tidak perlu diubah nama.

`leaveTypeName(code)` sedia ada kekal sebagai satu-satunya jalan untuk nama penuh.
`leaveReportLabel()` dibuang dan setiap pemanggilnya beralih kepada `leaveTypeName()`.

Kod warisan `PL` dalam `LEAVE_TYPE_NAMES` (`src/main.js:620`) dikekalkan. Selepas
perubahan ini, `PL` dan `ML_PL` kedua-duanya dibaca "Cuti Paterniti (PL)" — ini
disengajakan, kerana kedua-duanya memang merujuk cuti yang sama; `PL` semata-mata
bentuk lama yang mungkin masih wujud dalam rekod bersejarah. Ujian keunikan hanya
merangkumi kod dalam `leaveCategories`, bukan pemetaan warisan.

Sempadan: mana-mana kod yang memapar jenis cuti kepada manusia mesti melalui
`leaveTypeName()` atau `leaveTypeShort()`. Tiada tempat lain patut menulis literal
`'EL_EMG'` atau `'ML_PL'` sebagai teks paparan.

## Perubahan mengikut fail

### `src/leaveTypes.js` (baru)

Katalog `LEAVE_CATEGORIES` (10 entri, termasuk `RL`), `LEAVE_TYPE_NAMES`,
`LEAVE_TYPE_SHORT`, `leaveTypeName()`, `leaveTypeShort()`. Tiada import selain
tiada — modul tulen.

### `src/main.js`

| Lokasi (lebih kurang) | Perubahan                                                                       |
| --------------------- | ------------------------------------------------------------------------------- |
| `:605`–`:622`         | Buang `leaveCategories`/`LEAVE_TYPE_NAMES`/`leaveTypeName`; import dari modul baru |
| `:2148`               | Borang cuti cetak — tambah kotak `[ ] CUTI GANTI`                                |
| `:2873`               | `LEAVE_TYPE_COLOR` — tambah `RL:'#14b8a6'`                                       |
| `:2874`               | `ALL_LEAVE_TYPES` — tambah `'RL'`                                                |
| `:2877`               | Buang `leaveReportLabel()`; pemanggil beralih ke `leaveTypeName()`               |
| `:3256`, `:8195`      | `typeColors` / `typeColorMap` — tambah `RL`                                      |
| `:3265`, `:8219`      | Cip ringkasan Analisa — kod pendek melalui `leaveTypeShort()`                    |
| `:8244`               | Tajuk lajur jadual Jenis Cuti — kod pendek melalui `leaveTypeShort()`            |
| `:5456`               | Kad ranking Analisa — `Emergency Leave` → `Cuti Kecemasan`                       |
| `:5548`               | Peta label modal ranking — sama                                                  |
| `:5841`, `:5843`      | "Baki Cuti Lain" — `Cuti Paterniti (PL)`, `Cuti Kecemasan` (buang `(EL_EMG)`)    |
| `:6039`               | `filteredCategories` — `RL` hanya untuk `user.category === 'Doctor'`             |
| `:4893`, `:6049`      | `_noticeExempt` / `isNoticeExempt` — tambah `'RL'`                               |
| `:6062`, `:6073`      | `leaveIcons` + `leaveShort` — tambah `RL`                                        |
| `:8385`               | Dropdown laporan Baki — guna `leaveTypeShort(c.id)` bukan `c.id`                 |
| `:10341`              | Management Hub — `PL — Cuti Isteri Bersalin` → `PL — Cuti Paterniti`             |
| `:10345`              | Management Hub — `EL — Cuti Kecemasan` → `EMG — Cuti Kecemasan`                  |
| glosari `:521`        | Help-bot — betulkan nama `EL` (kini "Cuti Ehsan"); `RL` sudah tersenarai          |
| soalan lazim `:667`   | Help-bot — tambah satu entri Cuti Ganti (doktor sahaja, selepas mesyuarat)       |

Pemeriksaan keselamatan borang (`:6036`) mendapat baris seiring: jika
`selectedLeaveType === 'RL'` tetapi pengguna bukan doktor, kembali ke `'AL'`. Ini
menghalang jenis yang tidak layak daripada tersangkut apabila pengguna bertukar akaun.

### `generate_manual_pdf.cjs`, `generate_manual_v2.cjs`, `generate_manual_word.cjs`

Jadual jenis cuti dalam manual sistem diselaraskan dengan label baru dan mendapat
baris Cuti Ganti. Ini fail penjana di luar aplikasi — tiada kesan masa jalan.

## Aliran data

Tiada perubahan. Permohonan `RL` mengalir sama seperti `EL_EMG`: `record.type = 'RL'`,
dikira oleh `countLeaveDays()` sebagai hari bekerja, dilaluikan oleh logik kelulusan
sedia ada, dan dijumlahkan dalam laporan melalui `ALL_LEAVE_TYPES`.

`getLeaveStats(staff, 'RL')` mengembalikan `ent: 0` (tiada `ent_RL` tersimpan, dan
`leaveCategories` memberi 0), jadi `bal: 0`. Kad "Baki Cuti Lain" pada dashboard staf
menapis `ent > 0`, jadi Cuti Ganti tidak muncul di sana — betul, kerana tiada baki
untuk dipaparkan.

## Pengendalian ralat

Tiada laluan ralat baru. Dua kes yang perlu berkelakuan baik:

- **Rekod dengan `type` yang tidak dikenali** (contoh `PL` warisan) — `leaveTypeName()`
  dan `leaveTypeShort()` kedua-duanya kembali kepada kod mentah. Kekal seperti sedia ada.
- **Bukan doktor memohon `RL`** — tidak boleh berlaku melalui antara muka kerana
  ditapis daripada senarai, dan pemeriksaan keselamatan `:6036` menangkap keadaan
  tersangkut. Tiada penguatkuasaan sisi pelayan ditambah; ini konsisten dengan cara
  `ML`/`ML_PL` ditapis mengikut jantina hari ini.

## Ujian

- `tests/leaveTypes.test.mjs` (baru) — mengesahkan `id` dalam `LEAVE_CATEGORIES` unik,
  setiap kod pendek unik selepas `leaveTypeShort()` dipakai (menangkap pertindihan
  `EL`/`EMG`), `EL_EMG`/`ML_PL` tidak pernah lagi dipapar mentah, `RL` wujud dan
  bukan ahli `FORMULA_B_TYPES`, dan kod tidak dikenali kembali sebagaimana adanya.
- `tests/formulaBTypes.test.mjs` sedia ada mesti kekal lulus tanpa diubah — `RL` tidak
  menyentuh Formula B.
- Semakan manual: mohon satu Cuti Ganti sebagai doktor, luluskan, dan sahkan ia muncul
  dalam laporan Semua Cuti serta jadual Analisa dengan lajur `RL`.

## Di luar skop

- Migrasi kod Firestore (`ML_PL` → `PL`) — ditolak secara sedar, lihat di atas.
- Kuota atau medan Management Hub untuk Cuti Ganti.
- Perubahan `firestore.rules`.
- Laluan kelulusan `shouldSkipP1`.
- Kelayakan `EL` (3 hari, Formula B) dan `ML_PL` (7 hari, hari kalendar) kekal.
