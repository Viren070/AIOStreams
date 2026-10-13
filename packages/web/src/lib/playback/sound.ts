import {
  AUDIO_DELAY_LIMIT_MS,
  AUDIO_DELAY_STEP_MS,
  settings,
} from '../settings';

export const dialogueLabel = (db: number) => (db ? `+${db} dB` : 'Off');

export function audioDelayLabel(ms: number): string {
  if (!ms) return 'In sync';
  return `${ms > 0 ? '+' : '−'}${Math.abs(ms)} ms`;
}

export function stepAudioDelay(steps: number): void {
  const next = settings.sound.delayMs.read() + steps * AUDIO_DELAY_STEP_MS;
  settings.sound.delayMs.write(
    Math.max(-AUDIO_DELAY_LIMIT_MS, Math.min(AUDIO_DELAY_LIMIT_MS, next))
  );
}
