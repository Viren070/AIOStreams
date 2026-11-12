import { readAll, type ByteReader } from '@/lib/byte-reader';

/** Family, full and PostScript names from the name table, lower case. */
export async function fontNames(
  reader: ByteReader,
  font: { at: number; size: number }
): Promise<string[]> {
  const top = await readAll(reader, font.at, Math.min(font.size, 4096));
  const at = async (offset: number, length: number) =>
    offset + length <= top.length
      ? top.subarray(offset, offset + length)
      : readAll(reader, font.at + offset, Math.min(length, font.size - offset));
  const view = (bytes: Uint8Array) =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (top.length < 12) return [];
  const first = view(top);
  const faces =
    first.getUint32(0) === 0x74746366
      ? Array.from({ length: Math.min(first.getUint32(8), 16) }, (_, i) =>
          first.getUint32(12 + i * 4)
        )
      : [0];
  const names = new Set<string>();
  for (const face of faces) {
    const counts = await at(face, 12);
    if (counts.length < 12) continue;
    const tables = view(counts).getUint16(4);
    const records = view(await at(face + 12, tables * 16));
    for (let i = 0; i < tables && (i + 1) * 16 <= records.byteLength; i++) {
      if (records.getUint32(i * 16) !== 0x6e616d65) continue;
      const offset = records.getUint32(i * 16 + 8);
      const length = Math.min(records.getUint32(i * 16 + 12), 256 * 1024);
      const table = await at(offset, length);
      const data = view(table);
      if (table.length < 6) break;
      const count = data.getUint16(2);
      const strings = data.getUint16(4);
      for (let r = 0; r < count && 6 + (r + 1) * 12 <= table.length; r++) {
        const row = 6 + r * 12;
        const platform = data.getUint16(row);
        const nameId = data.getUint16(row + 6);
        if (![1, 4, 6, 16].includes(nameId)) continue;
        const size = data.getUint16(row + 8);
        const from = strings + data.getUint16(row + 10);
        const bytes = table.subarray(from, from + size);
        let name = '';
        if (platform === 0 || platform === 3) {
          for (let c = 0; c + 1 < bytes.length; c += 2)
            name += String.fromCharCode((bytes[c] << 8) | bytes[c + 1]);
        } else if (platform === 1) {
          name = String.fromCharCode(...bytes);
        }
        name = name.trim().toLowerCase();
        if (name) names.add(name);
      }
      break;
    }
  }
  return Array.from(names);
}
