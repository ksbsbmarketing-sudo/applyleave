// Satu-satunya sumber pemformatan nombor telefon. Tiada kebergantungan
// Firebase/DOM supaya boleh diuji unit dan diguna sama oleh aplikasi dan skrip.
//
// Fonnte menghantar WhatsApp ke format antarabangsa tanpa '+', jadi nombor MESTI
// disimpan sebagai 60XXXXXXXXX. Staf pula menaip nombor tempatan (013-652 9531),
// jadi borang perlu membetulkannya, bukan sekadar menolaknya — dulu 8 rekod
// tersimpan sebagai 01XXXXXXXX dan menyekat staf berkenaan menyimpan profil
// sendiri, kerana pengesahan berjalan sebelum apa-apa disimpan.
//
//   "013-652 9531"  → "60136529531"
//   "+60 17-899 87" → digit sahaja dikekalkan
//   ""              → "" (telefon medan pilihan)
export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '6' + digits;   // 0136529531 → 60136529531
  if (digits.startsWith('6')) return digits;         // sudah betul
  return '60' + digits;                              // 136529531  → 60136529531
}

// Nombor kosong dianggap sah — staf tanpa telefon dibenarkan menyimpan profil.
export function isValidPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return true;
  return digits.startsWith('6') && digits.length >= 10 && digits.length <= 12;
}
