// Build-link codec. Format: "<version>.<base64url payload>", used as ?b=...
// APPEND-ONLY: never change or remove a decoder. Every link ever shared must keep working.
// Raw build shape: { level: int, attrs: int[5], perks: int[], cyber: [groupN, slotPos, implantN][] }  (all IDs are permanent registry numbers "n")

const MAX_PERKS = 4096;
const MAX_CYBER = 256;

function toB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad-chars');
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function writeVarint(out, n) {
  while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
}

function readVarint(bytes, pos) {
  let n = 0, mul = 1;
  for (let i = 0; i < 5; i++) {
    if (pos.i >= bytes.length) throw new Error('truncated');
    const b = bytes[pos.i++];
    n += (b & 0x7f) * mul;
    if (!(b & 0x80)) return n;
    mul *= 128;
  }
  throw new Error('varint-too-long');
}

function readBase(bytes) {
  if (bytes.length < 7) throw new Error('truncated');
  const level = bytes[0];
  const attrs = Array.from(bytes.slice(1, 6));
  const pos = { i: 6 };
  const count = readVarint(bytes, pos);
  if (count > MAX_PERKS) throw new Error('too-many');
  const perks = [];
  let prev = 0;
  for (let k = 0; k < count; k++) {
    prev += readVarint(bytes, pos);
    perks.push(prev);
  }
  return { level, attrs, perks, pos };
}

// v1 payload: level(1) attrs(5 x 1) count(varint) then perk n's sorted ascending, delta-coded varints.
// v2 payload: the v1 payload, then cyberware: count(varint) and per filled slot: group n, slot position, implant n (varints),
//   sorted by (group n, position). Decoders are frozen: v1 links keep decoding forever (no cyberware).
const decoders = {
  1(bytes) {
    const { level, attrs, perks, pos } = readBase(bytes);
    if (pos.i !== bytes.length) throw new Error('trailing-bytes');
    return { level, attrs, perks, cyber: [] };
  },
  2(bytes) {
    const { level, attrs, perks, pos } = readBase(bytes);
    const count = readVarint(bytes, pos);
    if (count > MAX_CYBER) throw new Error('too-many');
    const cyber = [];
    for (let k = 0; k < count; k++) cyber.push([readVarint(bytes, pos), readVarint(bytes, pos), readVarint(bytes, pos)]);
    if (pos.i !== bytes.length) throw new Error('trailing-bytes');
    return { level, attrs, perks, cyber };
  },
};

export const CURRENT_VERSION = 2;

export function encode(build) {
  const out = [build.level & 0xff, ...build.attrs.slice(0, 5).map((v) => v & 0xff)];
  const perks = [...new Set(build.perks)].sort((a, b) => a - b);
  writeVarint(out, perks.length);
  let prev = 0;
  for (const n of perks) { writeVarint(out, n - prev); prev = n; }
  const cyber = [...(build.cyber || [])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  writeVarint(out, cyber.length);
  for (const entry of cyber) for (const v of entry) writeVarint(out, v);
  return `${CURRENT_VERSION}.${toB64url(Uint8Array.from(out))}`;
}

// Never throws. Returns { ok: true, version, build } or { ok: false, reason, version? }.
export function decode(param) {
  try {
    if (typeof param !== 'string') return { ok: false, reason: 'empty' };
    const m = /^(\d{1,4})\.([A-Za-z0-9_-]*)$/.exec(param.trim());
    if (!m) return { ok: false, reason: 'malformed' };
    const version = Number(m[1]);
    const dec = decoders[version];
    if (!dec) return { ok: false, reason: 'unknown-version', version };
    return { ok: true, version, build: dec(fromB64url(m[2])) };
  } catch (e) {
    return { ok: false, reason: 'malformed' };
  }
}
