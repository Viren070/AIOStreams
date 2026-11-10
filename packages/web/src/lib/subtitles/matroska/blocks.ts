import {
  BLOCK,
  BLOCK_DURATION,
  CLUSTER,
  SIMPLE_BLOCK,
  TIMESTAMP,
  children,
  dataOf,
  head,
  uint,
  vint,
  whole,
  type Head,
} from './ebml';

export interface Block {
  track: number;
  /** Relative to the cluster, in the file's units. */
  relative: number;
  payload: Uint8Array;
  duration?: number;
}

export function readBlock(bytes: Uint8Array, element: Head): Block | null {
  const parse = (data: Uint8Array): Omit<Block, 'duration'> | null => {
    const track = vint(data, 0, false);
    if (!track || data.length < track[1] + 3) return null;
    const relative = new DataView(
      data.buffer,
      data.byteOffset + track[1],
      2
    ).getInt16(0);
    // Subtitle muxers never lace.
    if (data[track[1] + 2] & 0x06) return null;
    return { track: track[0], relative, payload: data.subarray(track[1] + 3) };
  };
  const data = bytes.subarray(element.length, element.length + element.size);
  if (element.id === SIMPLE_BLOCK) return parse(data);
  let block: Omit<Block, 'duration'> | null = null;
  let duration: number | undefined;
  for (const field of children(data, 0, data.length)) {
    if (!whole(data, field)) continue;
    if (field.id === BLOCK) block = parse(dataOf(data, field));
    if (field.id === BLOCK_DURATION) duration = uint(dataOf(data, field));
  }
  return block && { ...block, duration };
}

export function blockTrack(bytes: Uint8Array, element: Head): number | null {
  if (element.id === SIMPLE_BLOCK)
    return vint(bytes, element.length, false)?.[0] ?? null;
  for (const field of children(bytes, element.length, bytes.length)) {
    if (field.id === BLOCK) return vint(bytes, field.data, false)?.[0] ?? null;
  }
  return null;
}

export interface ClusterHead {
  data: number;
  /** Infinity for a cluster of unknown size. */
  end: number;
  timestamp?: number;
}

export function clusterHead(bytes: Uint8Array, at: number): ClusterHead | null {
  const found = head(bytes, 0);
  if (!found || found.id !== CLUSTER) return null;
  let timestamp: number | undefined;
  for (const field of children(bytes, found.length, bytes.length)) {
    if (field.id === TIMESTAMP && whole(bytes, field)) {
      timestamp = uint(dataOf(bytes, field));
      break;
    }
  }
  return {
    data: at + found.length,
    end: found.size < 0 ? Infinity : at + found.length + found.size,
    timestamp,
  };
}
