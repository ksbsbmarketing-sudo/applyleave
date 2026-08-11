import { test } from 'node:test';
import assert from 'node:assert';
import {
  LEAVE_CATEGORIES, LEAVE_TYPE_NAMES, LEAVE_TYPE_SHORT,
  leaveTypeName, leaveTypeShort,
  LEAVE_PROOF, PROOF_REQUIRED_TYPES, proofRequirement, hexToRgbTriple,
} from '../src/leaveTypes.js';
import { FORMULA_B_TYPES } from '../src/leaveBalance.js';

// Storage codes (EL_EMG, ML_PL) are frozen into every historical Firestore record.
// Only what a human READS changes. These tests pin that boundary.

test('storage ids are unchanged — renaming is a display concern only', () => {
  const ids = LEAVE_CATEGORIES.map(c => c.id);
  ['AL', 'MC', 'EL', 'EL_EMG', 'UP', 'HL', 'ML', 'ML_PL', 'CME'].forEach(id =>
    assert.ok(ids.includes(id), `${id} must survive — old records still use it`));
});

test('ids are unique', () => {
  const ids = LEAVE_CATEGORIES.map(c => c.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('the three renamed types read as agreed', () => {
  assert.strictEqual(leaveTypeName('EL'), 'Cuti Ehsan');
  assert.strictEqual(leaveTypeName('EL_EMG'), 'Cuti Kecemasan');
  assert.strictEqual(leaveTypeName('ML_PL'), 'Cuti Paterniti (PL)');
});

test('short codes never show the raw storage code', () => {
  assert.strictEqual(leaveTypeShort('EL'), 'EHSAN');
  assert.strictEqual(leaveTypeShort('EL_EMG'), 'EMG');
  assert.strictEqual(leaveTypeShort('ML_PL'), 'PL');
});

test('short codes stay unique — EMG exists so EL_EMG cannot collide with EL', () => {
  const shorts = LEAVE_CATEGORIES.map(c => leaveTypeShort(c.id));
  assert.strictEqual(new Set(shorts).size, shorts.length,
    `duplicate short code in ${shorts.join(',')}`);
});

test('no display string anywhere contains an underscore code', () => {
  LEAVE_CATEGORIES.forEach(c => {
    assert.ok(!c.name.includes('_'), `${c.id} name leaks a storage code: ${c.name}`);
    assert.ok(!leaveTypeShort(c.id).includes('_'), `${c.id} short code leaks an underscore`);
  });
});

// ── Cuti Ganti (RL) ───────────────────────────────────────────────────
test('RL exists, is called Cuti Ganti, and has no quota', () => {
  const rl = LEAVE_CATEGORIES.find(c => c.id === 'RL');
  assert.ok(rl, 'RL must be in the catalogue');
  assert.strictEqual(rl.name, 'Cuti Ganti');
  assert.strictEqual(rl.entitlement, 0, 'replacement leave is earned, not allocated');
});

test('RL is not a Formula B type — there is no balance to track', () => {
  assert.strictEqual(FORMULA_B_TYPES.includes('RL'), false);
});

// ── Fallbacks ─────────────────────────────────────────────────────────
test('legacy and unknown codes fall back to the raw code, not undefined', () => {
  assert.strictEqual(leaveTypeName('PL'), 'Cuti Paterniti (PL)'); // legacy alias, mapped
  assert.strictEqual(leaveTypeName('CF'), 'Cuti Bawa Ke Hadapan (CF)');
  assert.strictEqual(leaveTypeName('NONSENSE'), 'NONSENSE');
  assert.strictEqual(leaveTypeShort('NONSENSE'), 'NONSENSE');
});

test('the exported maps cannot be mutated by a caller', () => {
  const before = LEAVE_TYPE_SHORT.EL_EMG;
  try { LEAVE_TYPE_SHORT.EL_EMG = 'HACKED'; } catch { /* frozen throws in strict mode */ }
  assert.strictEqual(LEAVE_TYPE_SHORT.EL_EMG, before);
  try { LEAVE_TYPE_NAMES.EL = 'HACKED'; } catch { /* frozen */ }
  assert.strictEqual(LEAVE_TYPE_NAMES.EL, 'Cuti Ehsan');
});

// ── Proof requirement ─────────────────────────────────────────────────
// LEAVE_PROOF is the ONLY list of which leave types demand a document.
// Four call sites in main.js read it; none of them keeps its own copy.

test('CME requires proof — a doctor cannot apply without an invitation letter', () => {
  const cme = proofRequirement('CME');
  assert.ok(cme, 'CME must require proof');
  assert.strictEqual(cme.inputId, 'cme-upload');
});

test('the three original proof types still require proof', () => {
  ['MC', 'EL', 'EL_EMG'].forEach(id =>
    assert.ok(proofRequirement(id), `${id} required proof before this change and still must`));
});

test('RL requires NO proof — deliberate, do not "fix" this', () => {
  // Cuti Ganti is the other doctors-only claimed-after-the-fact type, so it
  // looks like an omission. It is not: it was excluded on purpose (spec
  // 2026-08-11, "Non-goals"). Adding it is a policy decision, not a bugfix.
  assert.strictEqual(proofRequirement('RL'), null);
});

test('types with no document requirement return null, not undefined', () => {
  ['AL', 'UP', 'HL', 'ML', 'ML_PL', 'NONSENSE'].forEach(id =>
    assert.strictEqual(proofRequirement(id), null, `${id} must not demand proof`));
});

test('every proof key is a real leave type — a typo would silently never fire', () => {
  const ids = LEAVE_CATEGORIES.map(c => c.id);
  PROOF_REQUIRED_TYPES.forEach(id =>
    assert.ok(ids.includes(id), `${id} is not in LEAVE_CATEGORIES`));
});

test('every entry is complete — a half-added type fails here, not in the browser', () => {
  const fields = ['inputId', 'title', 'hint', 'buttonLabel', 'barFrom', 'barTo', 'boxColor', 'notice', 'error'];
  PROOF_REQUIRED_TYPES.forEach(id => {
    fields.forEach(f => {
      const v = LEAVE_PROOF[id][f];
      assert.strictEqual(typeof v, 'string', `${id}.${f} must be a string`);
      assert.ok(v.length > 0, `${id}.${f} must not be empty`);
    });
  });
});

test('inputIds are unique and end in -upload — renderProofSection derives ids from them', () => {
  const inputs = PROOF_REQUIRED_TYPES.map(id => LEAVE_PROOF[id].inputId);
  assert.strictEqual(new Set(inputs).size, inputs.length, 'duplicate inputId');
  inputs.forEach(i => assert.ok(i.endsWith('-upload'),
    `${i} must end in -upload: the renderer builds the filename/notice element ids from that stem`));
});

test('colours are 6-digit hex — hexToRgbTriple assumes it', () => {
  PROOF_REQUIRED_TYPES.forEach(id => {
    ['barFrom', 'barTo', 'boxColor'].forEach(f =>
      assert.match(LEAVE_PROOF[id][f], /^#[0-9a-f]{6}$/, `${id}.${f}`));
  });
});

test('hexToRgbTriple converts to the comma triple CSS rgba() needs', () => {
  assert.strictEqual(hexToRgbTriple('#3b82f6'), '59,130,246');
  assert.strictEqual(hexToRgbTriple('#ef4444'), '239,68,68');
  assert.strictEqual(hexToRgbTriple('#f97316'), '249,115,22');
  assert.strictEqual(hexToRgbTriple('#8b5cf6'), '139,92,246');
  assert.strictEqual(hexToRgbTriple('#000000'), '0,0,0');
  assert.strictEqual(hexToRgbTriple('#ffffff'), '255,255,255');
});

test('CME proof copy names the document a doctor actually has', () => {
  // CME is applied for BEFORE attending, so the certificate does not exist yet.
  // The invitation letter or registration slip does. Both hint and error say so.
  const cme = proofRequirement('CME');
  assert.match(cme.hint, /jemputan|pendaftaran/i);
  assert.match(cme.error, /jemputan|pendaftaran/i);
});

test('LEAVE_PROOF cannot be mutated by a caller', () => {
  const before = LEAVE_PROOF.CME.inputId;
  try { LEAVE_PROOF.CME = 'HACKED'; } catch { /* frozen throws in strict mode */ }
  assert.strictEqual(LEAVE_PROOF.CME.inputId, before);
});
