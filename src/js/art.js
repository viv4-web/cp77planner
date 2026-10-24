// Art resolver: record ID -> game art path (live build) or an original placeholder glyph.
// The only difference between the live and offline builds is the art-map.json file.
const GLYPHS = 8;

function hash(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function makeResolver(map = {}) {
  return {
    // Returns { kind: 'art', src } or { kind: 'glyph', glyph }.
    resolve(id) {
      const src = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
      return typeof src === 'string' && src ? { kind: 'art', src } : { kind: 'glyph', glyph: hash(String(id)) % GLYPHS };
    },
    html(id, cls = '') {
      const r = this.resolve(id);
      if (r.kind === 'art') return `<img class="ico ${cls}" src="${r.src}" alt="" loading="lazy" decoding="async">`;
      return `<svg class="ico glyph ${cls}" viewBox="0 0 32 32" aria-hidden="true"><use href="img/placeholder/glyphs.svg#g${r.glyph}"/></svg>`;
    },
  };
}

export async function loadResolver(url = 'art-map.json') {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const map = await res.json();
    return makeResolver(map && typeof map === 'object' ? map : {});
  } catch (e) {
    return makeResolver({});
  }
}
