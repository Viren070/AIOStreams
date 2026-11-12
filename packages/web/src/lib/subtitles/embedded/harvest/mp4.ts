import { readAll, ReadError } from '@/lib/byte-reader';
import type { FileSubtitle } from '@/lib/subtitles/file-subtitle';
import {
  sampleText,
  type Mp4File,
  type Mp4Sample,
} from '@/lib/subtitles/mp4/file';
import {
  MERGE_GAP,
  MERGE_SPAN,
  SubtitleHarvest,
  WINDOWED_OVER,
  type HarvestTask,
  type ReadPace,
} from '.';

/** Reads the samples the sample tables list, one read per run of nearby ones. */
export class Mp4Harvest extends SubtitleHarvest {
  constructor(
    private readonly file: Mp4File,
    track: FileSubtitle,
    pace?: ReadPace
  ) {
    super(track, pace);
    const samples = file.samples.get(track.number) ?? [];
    this.windowed = samples.length > WINDOWED_OVER;
    let run: Mp4Sample[] = [];
    const flush = () => {
      if (!run.length) return;
      const group = run;
      run = [];
      const timeMs = group.reduce((ms, s) => Math.min(ms, s.startMs), Infinity);
      this.add(timeMs, (task) => this.readRun(group, task));
    };
    for (const sample of [...samples].sort((a, b) => a.at - b.at)) {
      const last = run[run.length - 1];
      if (
        last &&
        (sample.at - (last.at + last.size) > MERGE_GAP ||
          sample.at + sample.size - run[0].at > MERGE_SPAN)
      )
        flush();
      run.push(sample);
    }
    flush();
    this.tasks.sort((a, b) => a.timeMs - b.timeMs);
  }

  private async readRun(run: Mp4Sample[], task: HarvestTask): Promise<void> {
    const from = run[0].at;
    const last = run[run.length - 1];
    const length = last.at + last.size - from;
    const bytes = await readAll(this.file.reader, from, length);
    if (bytes.length < length)
      // eslint-disable-next-line lingui/no-unlocalized-strings -- only logged
      throw new ReadError('The samples were cut short', false);
    for (const { at, size, startMs, endMs } of run) {
      const text = sampleText(
        this.track.codec,
        bytes.subarray(at - from, at - from + size)
      );
      if (text) this.keep(at, { startMs, endMs, text }, task);
    }
  }
}
