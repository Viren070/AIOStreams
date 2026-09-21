import { Router, type Request, type Response } from 'express';
import { createHash } from 'crypto';
import {
  lookupFor,
  segmentsEnabled,
  segmentsFor,
  type Segment,
  type SegmentType,
  type UserData,
} from '@aiostreams/core';
import { jfOptional, param } from './context.js';
import { locate } from './playback.js';

const router: Router = Router({ mergeParams: true });

const TICKS_PER_MS = 10_000;
const KNOWN_TYPES: SegmentType[] = ['Intro', 'Recap', 'Outro'];
const EMPTY = { Items: [] as unknown[], TotalRecordCount: 0, StartIndex: 0 };

/**
 * Stable per (item, type) so a client that re-reads sees the same ids. Nothing
 * dereferences a segment id, it only has to be a guid-shaped constant.
 */
function segmentId(itemId: string, type: SegmentType): string {
  return createHash('sha256')
    .update(`${itemId}|${type}`)
    .digest('hex')
    .slice(0, 32);
}

/** Absent means every type; an empty array means the configuration turned them all off. */
function allowedTypes(userData: UserData): Set<SegmentType> | null {
  const configured = userData.jellyfin?.segmentTypes;
  return configured ? new Set(configured) : null;
}

function requestedTypes(req: Request): Set<string> | null {
  const raw = req.query.includeSegmentTypes;
  const values = (Array.isArray(raw) ? raw : [raw])
    .filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length ? new Set(values) : null;
}

async function mediaSegments(req: Request, res: Response) {
  if (!segmentsEnabled()) {
    res.json(EMPTY);
    return;
  }
  const itemId = param(req, 'itemId');
  const loc = await locate(req, itemId);
  if (!loc || loc.ctx.userData.jellyfin?.segments === false) {
    res.json(EMPTY);
    return;
  }

  // The memo is the only place a real runtime is on hand.
  const lookup = lookupFor(loc.descriptor, loc.memo?.runtimeMs);
  if (!lookup) {
    res.json(EMPTY);
    return;
  }

  const allowed = allowedTypes(loc.ctx.userData);
  const requested = requestedTypes(req);
  const wanted = (s: string) =>
    (!allowed || allowed.has(s as SegmentType)) &&
    (!requested || requested.has(s));
  // Only types we can produce, or a request for Commercial waits on every provider.
  const types = requested
    ? KNOWN_TYPES.filter(wanted)
    : allowed && [...allowed];
  if (types?.length === 0) {
    res.json(EMPTY);
    return;
  }
  const segments = (
    await segmentsFor(
      lookup,
      { pmdbApiKey: loc.ctx.userData.pmdbApiKey },
      types ?? undefined
    )
  ).filter((s: Segment) => wanted(s.type));

  res.json({
    Items: segments.map((s) => ({
      Id: segmentId(itemId, s.type),
      ItemId: itemId,
      Type: s.type,
      StartTicks: s.startMs * TICKS_PER_MS,
      EndTicks: s.endMs * TICKS_PER_MS,
    })),
    TotalRecordCount: segments.length,
    StartIndex: 0,
  });
}

router.get('/MediaSegments/:itemId', jfOptional(mediaSegments));

export default router;
