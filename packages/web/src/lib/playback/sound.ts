import { t } from '@lingui/core/macro';
import {
  AUDIO_DELAY_LIMIT_MS,
  AUDIO_DELAY_STEP_MS,
  settings,
} from '../settings';

export const dialogueLabel = (db: number) => (db ? t`+${db} dB` : t`Off`);

export function audioDelayLabel(ms: number): string {
  if (!ms) return t`In sync`;
  const amount = Math.abs(ms);
  return ms > 0 ? t`+${amount} ms` : t`−${amount} ms`;
}

export function stepAudioDelay(steps: number): void {
  const next = settings.audio.delayMs.read() + steps * AUDIO_DELAY_STEP_MS;
  settings.audio.delayMs.write(
    Math.max(-AUDIO_DELAY_LIMIT_MS, Math.min(AUDIO_DELAY_LIMIT_MS, next))
  );
}
