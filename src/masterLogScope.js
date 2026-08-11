// Skop Master Logs — negeri (zon) & cawangan.
//
// ZON IALAH SEMPADAN KESELAMATAN: HR Pahang tidak boleh nampak rekod
// Terengganu, dan sebaliknya. Tab negeri/cawangan hanyalah NAVIGASI di atas
// zon itu — `filterByScope` sengaja TIDAK mempercayai nilai tab, supaya nilai
// tab yang salah (atau diubah) tidak boleh meluaskan apa yang seseorang nampak.
//
// Tiada import DOM/Firebase di sini — itulah yang menjadikannya boleh diuji
// unit. Peleraian cawangan → negeri disuntik sebagai `stateOfBranch` kerana ia
// bergantung pada koleksi `branches` yang hidup dalam main.js, DAN kerana ia
// membawa pengecualian Utama (ROUTES_AS_PAHANG). Jangan salin senarai itu
// ke sini — ia sudah wujud dalam 3 fail.

export const ALL = 'ALL';
export const NO_BRANCH = '__NONE__';

// Negeri yang pengguna ini dibenarkan lihat. Sentinel ALL tiada di sini —
// tab SEMUA dilukis oleh pemanggil, dan hanya untuk skop 'all'.
export function visibleStates(userScope) {
  if (!userScope) return [];
  if (userScope === 'all') return ['Pahang', 'Terengganu'];
  return [userScope];
}

// Nama cawangan untuk baris tab cawangan, dalam zon pengguna dan (jika tab
// negeri dipilih) dalam negeri itu sahaja.
export function branchOptions(branches, { userScope, state = ALL, stateOfBranch }) {
  if (!userScope) return [];
  const allowed = visibleStates(userScope);
  return (branches || [])
    .filter(b => {
      const s = stateOfBranch(b.name);
      if (!s || !allowed.includes(s)) return false;
      if (state !== ALL && s !== state) return false;
      return true;
    })
    .map(b => b.name);
}

export function filterByScope(records, { userScope, state = ALL, branch = ALL, stateOfBranch }) {
  if (!userScope) return [];                       // gagal-tertutup
  const allowed = visibleStates(userScope);
  return (records || []).filter(r => {
    const s = stateOfBranch(r.branch);

    // Rekod tersadai — cawangan tiada dalam koleksi (ditukar nama/dipadam).
    // Hanya admin nampak, hanya pada tab negeri SEMUA, melalui tab cawangan
    // Semua atau Lain-lain. Ia tiada negeri, jadi ia bukan milik mana-mana
    // tab negeri bernama. (Rekod negeri-luar-zon di bawah jatuh ke baldi yang
    // sama, atas sebab yang sama — lihat komen di situ.)
    if (!s) {
      if (userScope !== 'all') return false;
      if (state !== ALL) return false;
      return branch === ALL || branch === NO_BRANCH;
    }

    // SEMPADAN ZON. Negeri di luar zon (cth. cawangan baharu di Kelantan, atau
    // state tersalah taip) bukan milik mana-mana tab negeri — ia jatuh ke baldi
    // Lain-lain supaya admin tetap nampak, sama seperti rekod tersadai. HR
    // kekal tidak nampak apa-apa di luar zonnya.
    if (!allowed.includes(s)) {
      if (userScope !== 'all') return false;
      if (state !== ALL) return false;
      return branch === ALL || branch === NO_BRANCH;
    }
    if (state !== ALL && s !== state) return false;
    if (branch === NO_BRANCH) return false;        // rekod ini ada cawangan
    if (branch !== ALL && r.branch !== branch) return false;
    return true;
  });
}
