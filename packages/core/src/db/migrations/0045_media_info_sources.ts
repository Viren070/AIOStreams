import type { Migration } from './types.js';

const rank = (column: string) =>
  `CASE WHEN ${column} LIKE 'nh1:%' OR ${column} LIKE 'btih:%' THEN 0
        WHEN ${column} LIKE 'nu1:%' THEN 1 ELSE 2 END`;

const ddl = `
      ALTER TABLE media_info ADD COLUMN title TEXT;
      ALTER TABLE media_info ADD COLUMN listed INTEGER NOT NULL DEFAULT 1;
      UPDATE media_info SET listed = 0
        WHERE EXISTS (
          SELECT 1 FROM media_info s
           WHERE s.origin = media_info.origin AND s.file = media_info.file
             AND s.info = media_info.info
             AND ${rank('s.release_key')} < ${rank('media_info.release_key')});

      CREATE INDEX IF NOT EXISTS idx_media_info_listed
        ON media_info (listed, updated_at);
      CREATE INDEX IF NOT EXISTS idx_media_info_origin
        ON media_info (origin, listed, created_at);

      ALTER TABLE media_info_probes RENAME COLUMN cause TO path;
      UPDATE media_info_probes SET path = 'stremio'
        WHERE path IN ('resolve', 'playback');
      UPDATE media_info_probes SET path = 'shares' WHERE path = 'share';
      ALTER TABLE media_info_probes
        ADD COLUMN kind TEXT NOT NULL DEFAULT 'usenet';
      ALTER TABLE media_info_probes
        ADD COLUMN reader TEXT NOT NULL DEFAULT 'engine';
`;

export const mediaInfoSources: Migration = {
  id: 45,
  name: 'media_info_sources',
  up: {
    sqlite: ddl,
    // Records are stored packed; SQLite keeps bytes in any column.
    postgres: `
      ALTER TABLE media_info
        ALTER COLUMN info TYPE BYTEA USING convert_to(info, 'UTF8');
      ${ddl}`,
  },
};
