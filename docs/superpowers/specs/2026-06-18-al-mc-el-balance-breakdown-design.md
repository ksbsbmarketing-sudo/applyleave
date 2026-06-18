# AL/MC/EL Balance Breakdown (Formula B) — Design

Date: 2026-06-18

## Goal
Management Hub staff-edit shows a full, transparent balance breakdown for AL, MC,
and EL (Ehsan), using one universal formula. The balance is computed (never stored),
and the same formula is the single source of truth across the whole app.

## Formula (per leave type)
```
Baki Sebenar = Jumlah Peruntukan − Guna Sebelum Sistem − Guna Dalam Sistem − Pelarasan HR
```
- **AL**: Jumlah = `ent_CF + ent_AL` (has carry-forward)
- **MC**: Jumlah = `ent_MC` (no CF)
- **EL** (id `EL`, Ehsan, default 3): Jumlah = `ent_EL` (no CF)
- All deductions clamp: `bal = max(0, Jumlah − used_pre − used_sys − pelarasan)`

## New DB fields (HR-editable, default 0)
| Type | Guna Sebelum Sistem | Pelarasan HR |
|------|---------------------|--------------|
| AL | `al_used_pre` | `al_pelarasan` |
| MC | `mc_used_pre` | `mc_pelarasan` |
| EL | `el_used_pre` | `el_pelarasan` |

- **Guna Dalam Sistem** = sum of `APPROVED` records of that type (computed; not stored).
- Legacy `al_adj` ("baki tinggal") is **deprecated / no longer read**. Existing values ignored.

## Components shown in HR edit modal (per type)
CF (AL only) → Peruntukan setahun → Jumlah terkini (auto) → Guna Sebelum Sistem (input)
→ Guna Dalam Sistem (auto) → Pelarasan HR (input) → Baki Sebenar (auto).

## Single source of truth
`getLeaveStats(staff, type)` implements Formula B for AL/MC/EL:
- `ent` = Jumlah Peruntukan (CF+ent_AL for AL; ent_MC / ent_EL otherwise)
- `used` = Guna Dalam Sistem (approved system records) — for the "Digunakan" display
- `bal` = `max(0, ent − used_pre − used − pelarasan)`
- also expose `usedPre`, `pelarasan` for display

`getEarnedAL` reverts to `ent_AL + ent_CF` (the Jumlah; no al_adj, no ÷12 prorata).

Downstream (auto-follow): personal dashboard AL card, "Baki Cuti Lain" cards,
report "SENARAI BILANGAN CUTI" (AL & MC columns; numerator = baki, denominator =
peruntukan setahun), apply-leave form summary + split logic, balance report.

## Migration impact
After deploy, new fields = 0 for everyone → interim balance = Jumlah − Guna Dalam Sistem
(e.g. DR ZAINAL 25 − 0 = 25, up from today's 20). HR must enter "Guna Sebelum Sistem"
and "Pelarasan HR" per staff to reach the real balance. (Owner accepted re-entry.)

## Files
- `src/main.js` — getLeaveStats, getEarnedAL, edit modal AL section + new MC/EL sections,
  modal save handler (persist 6 new fields), `_recomputeAlBalanceFields` (+ MC/EL recompute),
  report rows, dashboard card, apply-form summary.

## Out of scope
- EL_EMG (Kecemasan Am, ent 0), CME, HL, ML — unchanged.
- No data backfill/migration script; HR re-enters via the UI.
