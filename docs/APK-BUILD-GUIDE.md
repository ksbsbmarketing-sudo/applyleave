# Panduan Bina APK (KSB Portal — Cuti Staff)

App ini ialah **PWA** yang live di **https://cuti-staff.ksbsb.com.my/**. Cara paling
mudah untuk dapatkan fail **APK** ialah bungkus PWA sebagai **TWA** (Trusted Web
Activity) guna **PWABuilder** — APK kecil yang membuka laman live skrin penuh. Sebarang
kemas kini web terus muncul dalam app; tak perlu bina APK baru setiap kali.

> Sudah disediakan dalam repo (auto-deploy ke subdomain):
> - `public/manifest.json` — sedia TWA (ada `id`, ikon maskable).
> - `public/.well-known/assetlinks.json` — **templat**; perlu diisi selepas jana APK (Langkah 3).
> - `.htaccess` sedia ada menyajikan fail sebenar dulu, jadi `/.well-known/assetlinks.json` boleh diakses.

---

## Langkah 1 — Jana pakej Android di PWABuilder

1. Pergi ke **https://www.pwabuilder.com**.
2. Masukkan URL: **`https://cuti-staff.ksbsb.com.my/`** → klik **Start**.
3. Tunggu ia analisa manifest (patut hijau untuk Manifest & Service Worker).
4. Klik **Package For Stores** → kad **Android** → **Generate Package**.
5. Tetapan yang disyorkan:
   - **Package ID (Application ID):** `my.com.ksbsb.cutistaff`
   - **App name:** `KSB Portal` (atau `Cuti Staff KSB`)
   - **Launcher name:** `KSB Portal`
   - Biar pilihan lain sebagai lalai (Signing key = **Create new** buat kali pertama).
6. Klik **Download**. Awak dapat fail ZIP mengandungi:
   - `app-release-signed.apk` ← **ini APK untuk pasang**
   - `app-release.aab` (untuk Play Store nanti, jika perlu)
   - `signing.keystore` + `signing-key-info.txt` ← **SIMPAN SELAMAT** (wajib untuk kemas kini akan datang)
   - `assetlinks.json` ← nilai untuk Langkah 3
   - `next-steps.md`

> ⚠️ **Simpan `signing.keystore` + kata laluannya** di tempat selamat. Hilang = tak boleh
> keluarkan kemas kini APK yang sama pada masa depan (kena pasang semula dari kosong).

---

## Langkah 2 — (kali pertama sahaja) Fahami assetlinks

APK TWA hanya buka **skrin penuh tanpa bar URL** jika pelayan mengesahkan APK melalui
fail **Digital Asset Links** di:
`https://cuti-staff.ksbsb.com.my/.well-known/assetlinks.json`

Fail itu mesti mengandungi **package name** + **cap jari SHA-256** kunci tandatangan APK
tadi. PWABuilder dah beri nilai ini dalam `assetlinks.json` (dalam ZIP).

---

## Langkah 3 — Isi assetlinks.json dalam repo & deploy

1. Buka `assetlinks.json` daripada ZIP PWABuilder.
2. **Gantikan sepenuhnya** kandungan fail repo `public/.well-known/assetlinks.json`
   dengan kandungan `assetlinks.json` PWABuilder itu (ia ada `package_name` dan
   `sha256_cert_fingerprints` yang betul).
   - Pastikan `package_name` = `my.com.ksbsb.cutistaff` (atau ID yang awak pilih).
3. Commit & push ke `main`:
   ```
   git add public/.well-known/assetlinks.json
   git commit -m "chore(apk): assetlinks fingerprint for TWA"
   git push origin main
   ```
4. Tunggu GitHub Action "Deploy to cPanel" siap (~1 minit).
5. **Sahkan** di pelayar: buka
   `https://cuti-staff.ksbsb.com.my/.well-known/assetlinks.json`
   — patut papar nilai sebenar (bukan `REPLACE_WITH_...`).
   Boleh juga sahkan guna alat Google:
   `https://developers.google.com/digital-asset-links/tools/generator`

---

## Langkah 4 — Pasang APK di telefon staf

1. Hantar `app-release-signed.apk` ke telefon (WhatsApp/Drive/USB).
2. Di telefon: buka fail → jika diminta, benarkan **"Pasang dari sumber tidak dikenali"**
   (Install unknown apps) untuk aplikasi yang membuka fail itu.
3. Pasang & buka. Jika assetlinks betul, app buka **skrin penuh** (tiada bar URL).
   Jika masih ada bar URL: assetlinks belum sah — semak Langkah 3 (cap jari betul?
   fail dah live? cuba nyahpasang & pasang semula selepas beberapa minit).

---

## Kemas kini pada masa depan

- **Kandungan/web:** tak perlu buat apa-apa pada APK — TWA muat laman live, jadi setiap
  `push` ke `main` (auto-deploy) terus kelihatan dalam app.
- **Ikon/nama app / naik taraf TWA:** jana semula di PWABuilder guna **`signing.keystore`
  yang SAMA** (jangan buat kunci baru, atau assetlinks kena dikemas kini semula), edar APK baru.

## Nota
- APK jenis TWA ini **perlukan internet** (app memang guna Firebase).
- Untuk terbit di **Google Play** kelak: guna fail `.aab`, akaun Play Console (USD 25),
  dan assetlinks yang sama sudah memadai.
