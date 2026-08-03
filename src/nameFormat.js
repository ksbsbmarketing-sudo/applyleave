// Satu-satunya sumber pemformatan nama. Tiada kebergantungan Firebase/DOM supaya
// boleh diuji unit dan boleh diguna sama oleh aplikasi dan skrip Node.
//
// Standard sistem ialah HURUF BESAR penuh: "zahirah dahria binti mohamed basri"
// dan "Zahirah Dahria Binti Mohamed Basri" kedua-duanya menjadi
// "ZAHIRAH DAHRIA BINTI MOHAMED BASRI". Rekod lama bercampur CAPS/huruf kecil,
// jadi setiap nama yang disimpan (tambah staff, kelulusan pendaftaran, kemas kini
// profil sendiri) dilalukan di sini, dan normalize-names.js menggunakan fungsi
// yang SAMA untuk membersihkan rekod sedia ada.
//
// Ruang berlebihan dibuang; sempang, koma-atas, @ dan digit kekal seperti asal.
export function formatPersonName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}
