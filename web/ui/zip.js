// A ZIP archive of files, stored without compression. Enough for "Download ZIP"; any tool opens it.
// entries: [{ name, bytes }]

const TABLE = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(entries) {
  const utf8 = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    const crc = crc32(entry.bytes);
    const header = (signature, extra) => {
      const view = new DataView(new ArrayBuffer(extra ? 46 : 30));
      let at = 0;
      const u16 = (v) => { view.setUint16(at, v, true); at += 2; };
      const u32 = (v) => { view.setUint32(at, v, true); at += 4; };
      u32(signature);
      if (extra) u16(20);          // version made by
      u16(20); u16(0x0800); u16(0); // version needed, UTF-8 names, stored
      u16(0); u16(0x21);            // time and date: 1980-01-01, the format's zero
      u32(crc); u32(entry.bytes.length); u32(entry.bytes.length);
      u16(name.length); u16(0);
      if (extra) { u16(0); u16(0); u16(0); u32(0); u32(offset); }
      return new Uint8Array(view.buffer);
    };
    const local = header(0x04034b50, false);
    central.push(header(0x02014b50, true), name);
    parts.push(local, name, entry.bytes);
    offset += local.length + name.length + entry.bytes.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...parts, ...central, new Uint8Array(end.buffer)]) { out.set(part, at); at += part.length; }
  return out;
}
