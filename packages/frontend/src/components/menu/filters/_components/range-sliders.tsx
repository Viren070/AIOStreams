'use client';
import { Slider } from '../../../ui/slider/slider';
import { NumberInput } from '../../../ui/number-input';
import {
  MIN_SIZE,
  MAX_SIZE,
  MIN_BITRATE,
  MAX_BITRATE,
} from '../../../../../../core/src/utils/constants';

// Formatting helpers

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1000;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatBitrate(bitrate: number, round: boolean = false): string {
  if (!Number.isFinite(bitrate) || bitrate <= 0) return '0 bps';
  const k = 1000;
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  const i = Math.min(
    sizes.length - 1,
    Math.max(0, Math.floor(Math.log(bitrate) / Math.log(k)))
  );
  let value = bitrate / Math.pow(k, i);
  value = round ? Math.round(value) : parseFloat(value.toFixed(1));
  return `${value} ${sizes[i]}`;
}

// Generic MediaRangeSlider

export interface MediaRangeSliderProps {
  label: string;
  help?: string;
  moviesValue: [number, number];
  seriesValue: [number, number];
  animeValue: [number, number];
  onMoviesChange: (value: [number, number]) => void;
  onSeriesChange: (value: [number, number]) => void;
  onAnimeChange: (value: [number, number]) => void;
  min: number;
  max: number;
  formatValue: (value: number) => string;
  kind: string;
}

const MEDIA_CATEGORIES = [
  { key: 'movies', heading: 'Movies' },
  { key: 'series', heading: 'Series' },
  { key: 'anime', heading: 'Anime Series' },
] as const;

type CategoryKey = (typeof MEDIA_CATEGORIES)[number]['key'];

function MediaRangeSlider({
  label,
  help,
  moviesValue,
  seriesValue,
  animeValue,
  onMoviesChange,
  onSeriesChange,
  onAnimeChange,
  min,
  max,
  formatValue,
  kind,
}: MediaRangeSliderProps) {
  const values: Record<CategoryKey, [number, number]> = {
    movies: moviesValue,
    series: seriesValue,
    anime: animeValue,
  };
  const handlers: Record<CategoryKey, (v: [number, number]) => void> = {
    movies: onMoviesChange,
    series: onSeriesChange,
    anime: onAnimeChange,
  };

  return (
    <div className="space-y-6">
      <h4 className="text-base font-medium">{label}</h4>
      {MEDIA_CATEGORIES.map(({ key, heading }) => {
        const value = values[key];
        const onChange = handlers[key];
        return (
          <div key={key} className="space-y-2">
            <h5 className="text-sm font-medium text-[--muted]">{heading}</h5>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 min-w-0">
                <Slider
                  min={min}
                  max={max}
                  defaultValue={[min, max]}
                  step={max / 1000}
                  value={value}
                  onValueChange={(newValue) =>
                    newValue !== undefined &&
                    newValue?.[0] !== undefined &&
                    newValue?.[1] !== undefined &&
                    onChange([newValue[0], newValue[1]])
                  }
                  minStepsBetweenThumbs={1}
                  label={`${heading} ${kind} Range`}
                  help={help}
                />
                <div className="flex justify-between mt-1 text-xs text-[--muted]">
                  <span>{formatValue(value[0])}</span>
                  <span>{formatValue(value[1])}</span>
                </div>
              </div>
              <div className="flex gap-2 md:w-[240px] shrink-0">
                <NumberInput
                  label="Min"
                  step={max / 1000}
                  value={value[0]}
                  min={min}
                  max={value[1]}
                  onValueChange={(newValue) =>
                    newValue !== undefined && onChange([newValue, value[1]])
                  }
                />
                <NumberInput
                  label="Max"
                  step={max / 1000}
                  value={value[1]}
                  min={value[0]}
                  max={max}
                  onValueChange={(newValue) =>
                    newValue !== undefined && onChange([value[0], newValue])
                  }
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Convenience wrappers

export type SizeRangeSliderProps = Omit<
  MediaRangeSliderProps,
  'min' | 'max' | 'formatValue' | 'kind'
> & {
  min?: number;
  max?: number;
};

export function SizeRangeSlider({
  min = MIN_SIZE,
  max = MAX_SIZE,
  ...rest
}: SizeRangeSliderProps) {
  return (
    <MediaRangeSlider
      min={min}
      max={max}
      formatValue={formatBytes}
      kind="Size"
      {...rest}
    />
  );
}

export type BitrateRangeSliderProps = Omit<
  MediaRangeSliderProps,
  'min' | 'max' | 'formatValue' | 'kind'
> & {
  min?: number;
  max?: number;
};

export function BitrateRangeSlider({
  min = MIN_BITRATE,
  max = MAX_BITRATE,
  ...rest
}: BitrateRangeSliderProps) {
  return (
    <MediaRangeSlider
      min={min}
      max={max}
      formatValue={formatBitrate}
      kind="Bitrate"
      {...rest}
    />
  );
}
