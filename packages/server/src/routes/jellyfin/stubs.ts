import { Router } from 'express';

/*
 * Surfaces stock clients probe but that have no meaning here. Empty lists and
 * 204s keep them quiet; unknown routes still 404 (never 401, Kodi logs out).
 */
const router: Router = Router({ mergeParams: true });

const EMPTY_LIST = {
  Items: [] as unknown[],
  TotalRecordCount: 0,
  StartIndex: 0,
};

const LIST_ROUTES = [
  '/Users/:userId/Items/Intros',
  '/Items/:itemId/Intros',
  '/Users/:userId/Items/:itemId/Intros',
  '/Channels',
  '/Playlists',
  '/Collections',
  '/Studios',
  '/Artists',
  '/Artists/AlbumArtists',
  '/Years',
  '/Persons',
  '/Trailers',
  '/MusicGenres',
  '/LiveTv/Programs',
  '/LiveTv/Recordings',
  '/LiveTv/Timers',
  '/LiveTv/SeriesTimers',
  '/LiveTv/Channels',
  '/LiveTv/Programs/Recommended',
  '/LiveTv/Recordings/Folders',
  '/System/ActivityLog/Entries',
  '/Items/Suggestions',
  '/Users/:userId/Suggestions',
];

const ARRAY_ROUTES = [
  '/Plugins',
  '/ScheduledTasks',
  '/Packages',
  '/Repositories',
  '/Notifications/Types',
  '/Notifications/Services',
  '/Auth/Keys',
  '/Auth/PasswordResetProviders',
  '/Auth/Providers',
  '/Environment/Drives',
  '/Library/PhysicalPaths',
  '/Sessions/SyncPlay/List',
  '/SyncPlay/List',
  '/Items/:itemId/SpecialFeatures',
  '/Users/:userId/Items/:itemId/SpecialFeatures',
  '/Items/:itemId/LocalTrailers',
  '/Users/:userId/Items/:itemId/LocalTrailers',
  '/Items/:itemId/ThemeSongs',
  '/Items/:itemId/ThemeVideos',
  '/Videos/:itemId/AdditionalParts',
  '/Items/:itemId/Chapters',
];

for (const p of LIST_ROUTES) {
  router.get(p, (_req, res) => {
    res.json(EMPTY_LIST);
  });
}
for (const p of ARRAY_ROUTES) {
  router.get(p, (_req, res) => {
    res.json([]);
  });
}

router.get('/Items/:itemId/ThemeMedia', (req, res) => {
  const empty = { ...EMPTY_LIST, OwnerId: req.params.itemId };
  res.json({
    ThemeVideosResult: empty,
    ThemeSongsResult: empty,
    SoundtrackSongsResult: empty,
  });
});

router.get('/LiveTv/Info', (_req, res) => {
  res.json({ Services: [], IsEnabled: false, EnabledUsers: [] });
});
router.get('/LiveTv/GuideInfo', (_req, res) => {
  res.json({
    StartDate: new Date().toISOString(),
    EndDate: new Date().toISOString(),
  });
});
router.get('/Notifications/:userId/Summary', (_req, res) => {
  res.json({ UnreadCount: 0, MaxUnreadNotificationLevel: 'Normal' });
});
router.get('/Notifications/:userId', (_req, res) => {
  res.json({ Notifications: [], TotalRecordCount: 0 });
});

router.get('/Playback/BitrateTest', (req, res) => {
  const size = Math.min(
    Number(req.query.Size ?? req.query.size ?? 102400) || 102400,
    10 * 1024 * 1024
  );
  res.type('application/octet-stream').send(Buffer.alloc(size));
});

router.post(['/Items/:itemId/Refresh', '/Library/Refresh'], (_req, res) => {
  res.status(204).end();
});
router.get('/ClientLog/Document', (_req, res) => {
  res.status(204).end();
});
router.post('/ClientLog/Document', (_req, res) => {
  res.json({ FileName: 'client.log' });
});
router.delete('/Videos/ActiveEncodings', (_req, res) => {
  res.status(204).end();
});

export default router;
