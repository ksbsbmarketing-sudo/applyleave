# Paparan `EL` yang mengelirukan — Reka Bentuk

**Tarikh:** 2026-08-07
**Status:** Draf — menunggu semakan pengguna
**Skop:** Label paparan sahaja. Tiada perubahan pada kiraan baki, `id` Firestore, atau data sedia ada.

## Masalah

Dalam Management Hub (terutamanya modal *Kemaskini Profil & Baki Cuti*), blok Formula B
untuk Cuti Ehsan bertajuk **"EL — Cuti Ehsan — Peruntukan & Baki"**. Pengguna membaca
`EL` sebagai *Emergency Leave*, sedangkan dalam sistem ini:

| Kod simpanan | Nama sebenar | Singkatan paparan hari ini |
|---|---|---|
| `EL` | Cuti Ehsan (kematian keluarga terdekat) | `EL` |
| `EL_EMG` | Cuti Kecemasan (kecemasan am) | `EMG` |

Kod `EL` sudah bermaksud Ehsan sejak relabel 2026-08-05
(`docs/superpowers/specs/2026-08-05-leave-type-relabel-and-cuti-ganti-design.md`), tetapi
huruf `EL` masih terpampang di beberapa tempat — dan seksyen Polisi malah masih tersilap
menamakan `EL` sebagai "Cuti Kecemasan".

## Yang TIDAK berubah

- `id` dalam `LEAVE_CATEGORIES` (`EL`, `EL_EMG`) — ia wujud dalam setiap rekod cuti lama
  dan medan staf (`ent_EL`, `ent_EL_EMG`). Kekal selamanya.
- Kiraan baki. Cuti Ehsan kekal baldi 3 hari; hanya **lebihan** melebihi 3 hari limpah ke
  AL melalui `computeElOverflow` (`src/leaveBalance.js`), seperti direka pada 2026-07-16.
  Disahkan oleh pengguna dalam sesi ini: *"kekal macam sekarang"*.
- Singkatan `EMG` untuk `EL_EMG`, dan `PL` untuk `ML_PL`.

## Perubahan

### 1. Singkatan seluruh aplikasi

`src/leaveTypes.js` — tambah satu entri pada `LEAVE_TYPE_SHORT`:

```js
export const LEAVE_TYPE_SHORT = Object.freeze({
  EL:     'EHSAN',
  EL_EMG: 'EMG',
  ML_PL:  'PL',
});
```

Semua pemanggil `leaveTypeShort()` mendapat pembetulan serentak: chip status permohonan
(`main.js:7118`, `:7571`, `:8042`, `:8143`), kad aktiviti (`:6742`), tajuk lajur laporan
cetak (`:3260`, `:3275`), dropdown laporan diluluskan (`:8077`) dan laporan Baki (`:8387`),
tab jenis cuti (`:8221`, `:8246`, `:8410`).

Kesan sampingan yang diterima: dropdown memaparkan `EHSAN — Cuti Ehsan` (berulang tetapi
tidak mengelirukan), sama seperti `EMG — Cuti Kecemasan` hari ini.

Butang cetak-mengikut-jenis di `main.js:7977` mempunyai peta override tempatan
`{EL:'EHSAN', EL_EMG:'KECEMASAN', ML_PL:'PL'}`. Buang entri `EL` daripadanya supaya
`leaveTypeShort()` menjadi satu-satunya sumber. Entri `EL_EMG:'KECEMASAN'` dikekalkan —
butang itu memang mahu perkataan penuh.

### 2. Modal edit staff (`renderEditStaffModal`)

Helper `_leaveBreakdownHTML(prefix, typeId, title, annualDefault, accent)` (`main.js:10142`)
menerima satu parameter baharu `balanceLabel`, lalai kepada `typeId`:

```js
const _leaveBreakdownHTML = (prefix, typeId, title, annualDefault, accent, balanceLabel = typeId) => {
```

Label baki di `:10169` menggunakannya: `Baki ${balanceLabel} Sebenar`.

Pemanggil:

| Baris | Sekarang | Jadi |
|---|---|---|
| `:10326` (MC) | `'MC — Cuti Sakit'` | tiada perubahan (baki: `Baki MC Sebenar`) |
| `:10327` (EL) | `'EL — Cuti Ehsan'` | `'Cuti Ehsan (Kematian Keluarga Terdekat)'`, `balanceLabel = 'Cuti Ehsan'` |
| `:10329` (CME) | `'CME — Cuti Pendidikan Perubatan (Doktor)'` | tiada perubahan |

Nota limpahan pula, dua tempat menghasilkan teks yang sama:

- `main.js:10321` (render awal modal)
- `main.js:2008` (kemas kini langsung semasa `_recalcLeaveBalance`)

Kedua-duanya: `− X hari ditolak dari limpahan EL` → `− X hari ditolak dari limpahan Cuti Ehsan`.
Kedua-dua rentetan mesti ditukar serentak, jika tidak teks berubah selepas pengguna menaip.

### 3. Seksyen Polisi — pembetulan fakta

`main.js:9826` dan `:9831` masih menulis **"Cuti Kecemasan (EL)"**. Ini terbalik selepas
relabel 2026-08-05.

- `:9826` tajuk: `3. Perbandingan: Cuti Kecemasan (EL) vs Cuti Ehsan`
  → `3. Perbandingan: Cuti Kecemasan (EMG) vs Cuti Ehsan (EL)`
- `:9831` tajuk lajur: `Cuti Kecemasan (EL)` → `Cuti Kecemasan (EMG)`

Baris "Tolak Baki Cuti?" (`:9844`) untuk Cuti Ehsan berbunyi *"Tambahan Percuma (Tanpa
tolak AL)"*. Itu benar untuk 3 hari pertama sahaja. Tukar kepada:
*"Tambahan percuma untuk 3 hari pertama. Lebihan melebihi 3 hari ditolak dari AL."*

### 4. Amaran limpahan semasa staf memohon

`main.js:4828`:

```
Notis: Baki EL anda tinggal N hari. Permohonan D hari akan ditolak X hari dari EL dan Y hari dari Cuti Tahunan (AL).
```

→ ganti kedua-dua `EL` dengan `Cuti Ehsan`.

### 5. Lajur gabungan dalam jadual kehadiran

Lajur berlabel `EL` sebenarnya menjumlahkan **Ehsan + Kecemasan**
(`el = (ml['EL']||0)+(ml['EL_EMG']||0)`, `main.js:8545`; punca yang sama di `:8569`,
`:3131`, `:3175`). Lajur kekal bergabung — hanya label dan tooltip dibetulkan:

| Baris | Sekarang | Jadi |
|---|---|---|
| `main.js:8588` (skrin) | `title="Emergency Leave">EL` | `title="Cuti Ehsan + Cuti Kecemasan">EHSAN+KEC` |
| `main.js:3161` (cetak) | `>EL<` | `>EHSAN+KEC<` |

`min-width:42px` pada tajuk skrin dibiarkan — sel itu sudah membenarkan teks lebih lebar,
dan jadual dibalut `overflow-x:auto` (`:8580`).

## Ujian

`tests/leaveTypes.test.mjs` — tambah pada blok `LEAVE_TYPE_SHORT` sedia ada:

```js
assert.strictEqual(leaveTypeShort('EL'), 'EHSAN');
assert.strictEqual(leaveTypeShort('EL_EMG'), 'EMG');
```

Selebihnya ialah rentetan HTML di dalam `main.js`, yang tidak boleh diuji unit (ia mengimport
`style.css`, Firebase dan Chart.js). Pengesahan secara manual:

1. Management Hub → edit seorang staf. Blok itu berbunyi "Cuti Ehsan (Kematian Keluarga
   Terdekat) — Peruntukan & Baki" dan medan baki berbunyi "Baki Cuti Ehsan Sebenar".
   Tiada huruf `EL` bersendirian.
2. Isi `Guna Sebelum Sistem` EL melebihi 3 → nota di bawah "Baki AL Sebenar" berbunyi
   "ditolak dari limpahan Cuti Ehsan", dan teksnya kekal sama selepas menaip semula.
3. Grid bawah kekal memaparkan "EMG — Cuti Kecemasan" dan menyimpan ke `ent_EL_EMG`.
4. Panduan/Polisi → seksyen 3 kini berbunyi "Cuti Kecemasan (EMG) vs Cuti Ehsan (EL)".
5. Laporan Kehadiran (skrin dan cetak) → lajur berbunyi "EHSAN+KEC"; jumlah tidak berubah.
6. Baki setiap staf sebelum dan selepas adalah sama — tiada logik kiraan disentuh.

## Luar skop

- Menukar `id` mana-mana jenis cuti.
- Apa-apa perubahan pada formula baki atau dasar limpahan EL → AL.
- Memisahkan lajur gabungan Ehsan/Kecemasan kepada dua lajur.
- Penjana manual PDF (`generate_manual_v2.cjs`) — teksnya sudah membezakan EL dan EMG
  dengan betul.
