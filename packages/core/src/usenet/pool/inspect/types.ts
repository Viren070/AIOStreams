import type { FileCategory } from '../file-type.js';
import type { ArchiveInnerEntry } from '../archive/open/index.js';

export interface NzbContentFile {
  /** Index of this file within the NZB. */
  index: number;
  filename?: string;
  /** Decoded file size in bytes (best-effort). */
  size: number;
  /**
   * True when {@link size} is the exact decoded size (from the yEnc
   * `=ybegin size=` header or a definitive part range). False for estimates,
   * notably the encoded-size placeholder used for unprobed/failed files, which
   * is ~3% high and MUST NOT be used for archive volume offset mapping.
   */
  sizeExact?: boolean;
  category: FileCategory;
  format?: string;
  streamable: boolean;
  /**
   * Set when the file's content could not be inspected. `decode_failed` means
   * the article arrived but is not decodable yEnc (broken part headers,
   * uuencode-era posts); distinguished so the verdict can say "unsupported
   * encoding" instead of a generic failure.
   */
  error?: 'article_not_found' | 'open_failed' | 'decode_failed';
  /** Inner files when this is the representative member of an archive set. */
  archiveInner?: ArchiveInnerEntry[];
  /** When set, this entry refers to a file *inside* an archive (selection). */
  innerPath?: string;
}

export interface NzbContent {
  files: NzbContentFile[];
  /** True when at least one streamable video file exists. */
  streamable: boolean;
  /**
   * Begin/middle/end STAT sample of the best video's backing segments, when
   * availability sampling ran (see `sampleTargetAvailability`). `missing`
   * > 0 means a sampled segment was absent on every provider; the stream would
   * likely die mid-playback.
   */
  availability?: { sampled: number; missing: number };
  /**
   * Decoded leading bytes (≤16KB) of each successfully probed file, keyed by
   * NZB file index and aligned to file offset 0. The archive parse reads
   * per-volume headers straight from these instead of re-fetching segments.
   * TRANSIENT: in-memory hand-off only; cleared after archive inspection,
   * never serialized.
   */
  heads?: Map<number, Buffer>;
  /**
   * The pre-probe release STAT gate found a missing segment that did NOT
   * justify failing the import outright (sidecar / one volume of a pack).
   * Evidence-reducing optimisations (probe skipping for chased sets) must be
   * disabled for this import; the full probe pass maps the damage precisely.
   */
  gateMiss?: boolean;
}

export interface InspectOptions {
  /** 'quick' = first segment only (fast); 'full' = first + last segment. */
  mode?: 'quick' | 'full';
  /** Bound on concurrent file inspections. */
  concurrency?: number;
  /** Override the engine's availability sample-point count for this inspect. */
  availabilitySamplePoints?: number;
  /**
   * Skip middle-volume probes of par2-named RAR sets (lazy fragment
   * resolution). The skipped volumes' exact sizes come from the PAR2
   * descriptors; their headers are read on first touch during playback.
   */
  lazyArchives?: boolean;
  signal?: AbortSignal;
}

export interface InspectResult {
  file: NzbContentFile;
  /** First ≤16 KiB of decoded content, retained for PAR2 matching. */
  head?: Buffer;
  /**
   * Whether {@link head} starts at file offset 0 (yEnc part begins at 1).
   * Only aligned heads may feed the archive header parse; a shifted head
   * would silently corrupt volume offsets.
   */
  headAligned?: boolean;
}
