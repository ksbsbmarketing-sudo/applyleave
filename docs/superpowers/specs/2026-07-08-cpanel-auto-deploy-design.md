# Reka Bentuk: Auto-deploy ke Subdomain cPanel via GitHub Actions

**Tarikh:** 2026-07-08
**Status:** Diluluskan (menunggu semakan spec)

## Masalah

Sistem KSB Leave Apply di-hos di **dua tempat berasingan**:

1. **Firebase Hosting** — dikemas kini bila `firebase deploy`.
2. **Subdomain cPanel (Apache)** — salinan `dist/` yang **di-upload manual**.

Folder `dist/` di-`gitignore`, jadi push ke GitHub tidak menyentuh cPanel langsung.
Akibatnya, perubahan kod (cth commit `565a694` — tarikh permohonan pada kad
Awaiting Authorization) tidak muncul di subdomain kerana build baru tidak
di-upload. Setiap kemas kini memerlukan langkah manual: build → zip → upload →
extract → overwrite.

## Matlamat

Bila pengguna `commit` + `push` ke `main`, subdomain cPanel dikemas kini
**automatik** tanpa langkah manual.

Bukan matlamat (YAGNI):
- Auto-deploy ke Firebase (kekal proses `firebase deploy` sedia ada).
- Menyatukan hosting (buang cPanel / tukar DNS).
- Pemberitahuan/notifikasi selepas deploy.

## Pendekatan Terpilih

**GitHub Actions** menjalankan build dan upload FTP pada setiap push ke `main`.
Dipilih kerana ia sepadan dengan tabiat sedia ada pengguna (commit + push) dan
tidak memerlukan alat baru di PC pengguna. Kelayakan FTP disimpan sebagai
GitHub Secrets (pengguna ada akses FTP — disahkan).

Pendekatan alternatif yang ditolak:
- **Skrip deploy setempat (`npm run deploy`)** — satu arahan, tapi masih manual
  dan bergantung pada mesin pengguna.
- **Halakan subdomain ke Firebase (DNS)** — hapus double-hosting terus, tapi
  melibatkan perubahan DNS dan membuang setup cPanel sedia ada.

## Seni Bina

Satu fail baru sahaja: `.github/workflows/deploy.yml`. Tiada perubahan pada
kod aplikasi.

### Aliran

```
push ke main
   ↓
GitHub Actions (ubuntu-latest)
   ↓ checkout
   ↓ setup Node (versi ~20)
   ↓ npm ci
   ↓ npm run build        → hasilkan dist/
   ↓ FTP-Deploy-Action    → sync dist/ → folder subdomain cPanel
   ↓
Subdomain dikemas kini ✅
```

### Komponen: `.github/workflows/deploy.yml`

- **Trigger:** `on: push: branches: [main]`. Boleh tambah `workflow_dispatch`
  untuk deploy manual dari UI GitHub bila perlu.
- **Job build-and-deploy:**
  - `actions/checkout`
  - `actions/setup-node` (Node 20, `cache: npm`)
  - `npm ci`
  - `npm run build`
  - `SamKirkland/FTP-Deploy-Action` dengan:
    - `server: ${{ secrets.FTP_SERVER }}`
    - `username: ${{ secrets.FTP_USERNAME }}`
    - `password: ${{ secrets.FTP_PASSWORD }}`
    - `server-dir: ${{ secrets.FTP_SERVER_DIR }}` (cth `/public_html/apply/`)
    - `local-dir: ./dist/`
    - `protocol: ftps` (utamakan FTPS; jatuh ke `ftp` jika hos tak sokong)

### GitHub Secrets (dimasukkan oleh pengguna sekali sahaja)

| Secret | Isi | Contoh |
|---|---|---|
| `FTP_SERVER` | Host FTP cPanel | `ftp.namadomain.com` |
| `FTP_USERNAME` | Username FTP | `apply@namadomain.com` |
| `FTP_PASSWORD` | Password FTP | (rahsia) |
| `FTP_SERVER_DIR` | Laluan docroot subdomain | `/public_html/apply/` |

Password tidak pernah muncul dalam kod atau log; disimpan dalam
GitHub → Settings → Secrets and variables → Actions.

## Pengendalian Ralat

- Jika `npm run build` gagal (kod ada error), job berhenti dan **tiada apa
  di-upload** — melindungi subdomain daripada versi rosak.
- FTP-Deploy-Action guna **sync berasaskan keadaan** (state-based): hanya fail
  berubah di-upload; fail lain di server tidak dipadam secara agresif.
- `.htaccess` disertakan dalam `dist/` (SPA fallback), jadi routing kekal betul.

## Nota Operasi

- Deploy ambil ~1–2 minit selepas push (bukan serta-merta).
- **Cache PWA:** service worker (`sw.js`) guna strategi network-first untuk
  HTML, jadi satu *hard refresh* (Ctrl+Shift+R) atau butang "Muat Semula"
  dalam app sudah memadai selepas deploy. Rujuk nota `pwa-cache-gotcha`.
- Firebase Hosting kekal berasingan — deploy Firebase masih manual buat masa ini.

## Nota Pelaksanaan Sebenar (kemas kini 2026-07-08 — SIAP & LIVE)

Beberapa perkara berbeza daripada draf awal, disahkan semasa deploy:

- **`npm ci` → `npm install`**: lock file dijana di Windows, tak sync dengan
  pakej Linux-only (`@emnapi/*`) di CI. Guna `npm install --no-audit --no-fund`.
- **Akaun cPanel utama TAK boleh FTP**: walaupun `ksbsbcom` boleh login web
  cPanel (port 2083), server FTP menolaknya (530). Perlu **FTP account khas**.
  Dicipta: `deploy@ksbsb.com.my`, berakar terus di docroot subdomain.
- **`FTP_SERVER_DIR = /`** (bukan `/public_html/...`): sebab akaun FTP khas tu
  sudah berakar di folder `cuti-staff.ksbsb.com.my`.
- **`FTP_SERVER = ksbsb.com.my`** (host sama dengan cPanel; `ftp.` juga berfungsi).
- Nilai secret sebenar diset via `gh secret set` (bukan UI), sebab percubaan
  manual pengguna tersimpan di tempat salah.

## Kriteria Kejayaan

1. Push perubahan kecil ke `main` → dalam ~2 minit, perubahan muncul di
   subdomain cPanel selepas hard refresh, tanpa sebarang upload manual.
2. Push kod yang gagal build → deploy tidak berlaku, subdomain kekal versi
   lama yang stabil.
