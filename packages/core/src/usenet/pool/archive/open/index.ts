/**
 * Archive opening. The public surface over `./open/*`:
 *   - `open/descriptor.ts` inner-file descriptors + RandomAccess construction
 *   - `open/layout.ts`     cached stream layouts ((de)serialize + rebuild)
 *   - `open/parse.ts`      RAR/7z parse dispatch + volume-set opening
 *   - `open/nesting.ts`    nested archive grouping + entry classification
 *   - `open/sets.ts`       archive-set grouping + inner-file inspection
 *   - `open/opener.ts`     opening one inner file as a seekable stream
 */
export { hasPendingFragments } from './descriptor.js';
export type { InnerDescriptor } from './descriptor.js';
export {
  serializeArchiveLayout,
  deserializeArchiveLayout,
  rebuildArchiveStream,
} from './layout.js';
export type { ArchiveStreamLayout, FileOpener } from './layout.js';
export { groupArchiveSets, inspectArchiveSets } from './sets.js';
export type {
  ArchiveInnerEntry,
  ArchiveSetSpec,
  ArchiveSetInfo,
  ContentFileRef,
} from './sets.js';
export { openArchiveInner } from './opener.js';
export type { OpenInnerOptions, OpenedInner } from './opener.js';
