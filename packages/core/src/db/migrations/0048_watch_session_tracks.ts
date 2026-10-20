import type { Migration } from './types.js';

const columns = (ine: string) => `
      ALTER TABLE watch_sessions ADD COLUMN ${ine}media_source_id TEXT;
      ALTER TABLE watch_sessions ADD COLUMN ${ine}audio_stream_index INTEGER;
      ALTER TABLE watch_sessions ADD COLUMN ${ine}subtitle_stream_index INTEGER;
`;

export const watchSessionTracks: Migration = {
  id: 48,
  name: 'watch_session_tracks',
  up: {
    sqlite: columns(''),
    postgres: columns('IF NOT EXISTS '),
  },
};
