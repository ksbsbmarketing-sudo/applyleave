# Buang Ciri Messenger Secara Total — Reka Bentuk

**Tarikh:** 2026-08-04
**Status:** Diluluskan
**Cawangan:** `remove-messenger`

## Matlamat

Hapuskan ciri Messenger sepenuhnya daripada aplikasi KSB Leave Apply — termasuk
tab navigasi, semua kod, gaya CSS, modul sokongan, ujian, dan peraturan
keselamatan yang khusus untuk Messenger.

## Bukan Matlamat

- **Tidak** memadam data sedia ada dalam Firestore (`messenger_rooms`,
  `messenger_messages`, `user_presence`). Data itu dibiarkan yatim tetapi tidak
  boleh diakses selepas peraturan dibuang. Sebab: projek berada pada pelan
  Spark; operasi padam pukal membakar kuota harian dan tidak boleh dibatalkan.
- **Tidak** menyentuh ciri Inbox (notifikasi cuti). Inbox ialah sistem berasingan
  yang kekal berfungsi.
- **Tidak** membuang muat naik gambar profil. Ia dikongsi dengan borang Tetapan.

## Keputusan Reka Bentuk

| Keputusan | Pilihan | Sebab |
|---|---|---|
| Data Firestore lama | Biarkan, buang peraturan sahaja | Jimat kuota Spark; tidak boleh undo kalau dipadam |
| Sistem Presence | Buang total | Hanya dipakai oleh Messenger; pembakar kuota Firestore #1 |
| Penjana manual PDF | Kemas kini, buang bab Messenger | Kalau tidak, penjana gagal bila cuba screenshot tab yang tiada |

## Skop Perubahan

### 1. `src/main.js`

Fail ini ~11,857 baris dan mengandungi ~188 rujukan Messenger. Buang:

**a. Import (baris 5–7)**
- `./msgSections.js`, `./emoticons.js`, `./presenceStatus.js`

**b. Pemboleh ubah keadaan (baris ~617–648)**
- Semua `messenger*` (roomId, roomName, roomType, messages, unsubs, view, tab,
  newChatOpen, sending, roomLastMsg, unreadRooms, roomsInitialLoad)
- `presenceUnsub`, `presenceHeartbeatInterval`, `PRESENCE_HEARTBEAT_MS`
- `msgSections`, `myStatus`, `myStatusMsg`, `msgToasts`
- `buzzListenStart`, `processedBuzzIds`, `lastBuzzSentAt`

**c. Fungsi kesan BUZZ (baris ~650–677)**
- `playBuzz()`, `triggerBuzzEffect()`

**d. Blok `MESSENGER MODULE` (baris ~4628–5700)** — buang sepenuhnya:
- `safeBranchId()`, `getDMRoomId()`
- Presence: `initPresence()`, `stopPresence()`, `setMyPresenceStatus()`, mood setter
- Toast: `showMsgToast()`, `renderActiveToasts()`, `openMsgToast()`, `dismissMsgToast()`
- Notifikasi pelayar: `showBrowserNotif()`
- Pendengar: `startNewMessageListener()`, `stopNewMessageListener()`,
  `initMessengerRooms()`, `myMessengerRoomIds()`, `MSG_ROLE_ROOM_IDS`
- Bilik & mesej: `openRoom()`, `openDM()`, `backToRooms()`, `sendMessage()`,
  `sendBuzz()`, `deleteMessage()`, `handleMessengerFile()`, `cancelMessengerFile()`
- UI: `setMessengerTab()`, `openNewChat()`, `closeNewChat()`, `filterMsgStaff()`,
  `formatMsgTime()`, `formatFileSize()`, `getFileIcon()`, `renderMessageBubble()`,
  `msgSectionHeader()`, `toggleMsgSection()`, `renderMessengerView()`

**KEKALKAN** dua fungsi dalam julat ini kerana ia dikongsi:
- `escapeHtml()` — dipakai borang profil Tetapan (baris ~11466)
- `window.uploadProfilePhoto()` — dipakai borang profil Tetapan

Pindahkan kedua-duanya ke bahagian utiliti am sebelum blok Messenger dibuang.

> **PENTING — ditemui semasa pelaksanaan:** sepanduk komen `MESSENGER MODULE`
> menipu. Keseluruhan **modul Inbox** duduk di dalam julat baris itu walaupun ia
> tiada kaitan langsung dengan Messenger. Sepuluh fungsi ini MESTI dikekalkan:
> `requestNotifPermission`, `addNotification`, `notifyApproversInbox`,
> `markNotifRead`, `markAllNotifsRead`, `toggleNotifSelect`,
> `toggleSelectAllNotifs`, `deleteSelectedNotifs`, `showInboxBrowserNotif`,
> `initInbox`.
>
> `window.addNotification` sahaja dipanggil dari 7 tempat dalam aliran cuti.
> Memadam blok itu secara buta memecahkan log masuk sepenuhnya
> (`window.initInbox is not a function`). Jangan percaya sempadan komen —
> sahkan setiap takrif dalam julat yang dibuang terhadap rujukan yang tinggal.
>
> `playMsgSound()` pula memang milik Messenger (dipanggil hanya oleh toast
> mesej), jadi ia dibuang.

**e. Titik integrasi**
- `setView()` (baris ~456–466): buang reset keadaan messenger + panggilan
  `initPresence()`/`stopPresence()`
- `logout()` (baris ~4596–4621): buang unsub messenger, `stopPresence()`,
  `stopNewMessageListener()`, pembersihan `msgToasts`
- Baris ~3617–3621 dan ~4278–4281: buang `initMessengerRooms()` dan
  `startNewMessageListener()`
- Baris ~5754: buang panggilan `renderActiveToasts()`
- Baris ~6949: buang `case 'messenger':` daripada penghala paparan

**f. Navigasi**
- Baris ~5724: buang item nav sidebar "Messenger" (termasuk lencana belum baca)
- Baris ~5697: buang item menu FAB mudah alih "Messenger"

**g. RBAC (baris ~871–943)**
- Buang kunci `messenger: true` daripada kesemua 13 peranan dalam `ROLE_DEFAULTS`
- Nota: dokumen `role_permissions` dalam Firestore mungkin masih menyimpan kunci
  `messenger`. Ia menjadi kunci yatim yang tidak berbahaya — tiada kod membacanya.

**h. Help-bot (baris ~804)**
Tulis semula jawapan yang mencadangkan "hubungi HR/Admin melalui Messenger"
supaya hanya merujuk nombor telefon rasmi klinik.

### 2. Fail dipadam

```
src/msgSections.js
src/emoticons.js
src/presenceStatus.js
tests/msgSections.test.mjs
tests/emoticons.test.mjs
tests/presenceStatus.test.mjs
tests/rules_messenger.test.mjs
```

### 3. `src/style.css`

Buang ~124 peraturan gaya khusus Messenger, bermula sekitar baris 848:
`.messenger-layout`, semua `.msg-*` (rooms panel, chat panel, bubble, toast,
avatar, tab, buzz button, file card), `.buzz-shake` + keyframe-nya, dan titik
status presence. Sahkan tiada kelas `.msg-*` dirujuk oleh paparan lain sebelum
membuang.

### 4. `firestore.rules`

Buang tiga blok (baris ~98–110):
```
match /messenger_rooms/{id}      { ... }
match /messenger_messages/{mid}  { ... }
match /user_presence/{id}        { ... }
```

### 5. `storage.rules`

Buang `match /messenger/{roomId}/{fileName}` (baris ~33–34) dan kemas kini komen
baris 15 yang merujuk "messenger rule".

### 6. `generate_manual_v2.cjs`

Ditemui semasa pelaksanaan — penjana manual **kedua** dengan babnya sendiri.
Buang BAB 7 (Messenger Dalaman), nombor semula BAB 8–10 → 7–9 berserta seksyen
8.x–10.x, dan tukar baris "Hubungi Super Admin melalui Messenger atau WhatsApp"
kepada WhatsApp sahaja.

### 7. `generate_manual_pdf.cjs`

Buang ~17 rujukan Messenger: langkah screenshot yang menavigasi ke tab Messenger
dan bab manual yang menerangkannya. Tanpa ini penjana akan tergantung atau gagal
kerana pemilih tab tidak lagi wujud.

## Fail yang TIDAK disentuh

- `docs/superpowers/specs/*` dan `docs/superpowers/plans/*` sedia ada yang
  menyebut Messenger — ini rekod sejarah, bukan kod hidup.
- `firestore.indexes.json` — tiada indeks Messenger di dalamnya.
- Sebarang kod Inbox, cuti, atau laporan.

## Pengesahan

Selepas semua perubahan:

1. `npm run build` — mesti siap tanpa ralat (menangkap import yang putus)
2. `npx vitest run` — semua ujian yang tinggal mesti hijau
3. `grep -ri "messenger\|presence\|buzz\|emoticon" src/ index.html` — mesti
   pulangkan sifar padanan
4. Jalankan app, log masuk, sahkan:
   - Tiada tab Messenger dalam sidebar mahupun menu FAB mudah alih
   - Dashboard, Borang Cuti, Management, Inbox, Polisi, Tetapan semua muat
   - Muat naik gambar profil dalam Tetapan masih berfungsi (ujian regresi
     terpenting — ia berkongsi kod dengan Messenger)

## Risiko

| Risiko | Mitigasi |
|---|---|
| `escapeHtml`/`uploadProfilePhoto` terbuang tak sengaja | Pindah ke bahagian utiliti dahulu, sebelum memadam blok |
| Peraturan CSS dikongsi paparan lain | Grep setiap kelas `.msg-*` sebelum buang |
| Pengguna masih ada tab Messenger dalam cache | Cache service worker — beritahu pengguna hard-refresh selepas deploy (lihat memori pwa-cache-gotcha) |
| Deploy rules sebelum klien | Deploy klien dahulu, kemudian rules — sama seperti amalan messenger-dm-privacy |
