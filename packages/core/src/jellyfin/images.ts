import { createHmac } from 'crypto';
import { config as appConfig } from '../config/index.js';
import { constantTimeEquals } from '../utils/auth.js';
import { Cache } from '../utils/cache.js';
import type { ImageKind, ItemImages } from './types.js';

/*
 * The image tag a client echoes back carries the image URL itself, so the
 * image route needs no lookup: `<signature><host code><base64url of the rest>`.
 */
const HOST_PREFIXES: [string, string][] = [
  ['1', 'https://images.metahub.space/'],
  ['2', 'https://image.tmdb.org/t/p/'],
  ['3', 'https://artworks.thetvdb.com/'],
  ['4', 'https://assets.fanart.tv/'],
  ['5', 'https://images.metahub.space/background/medium/'],
];

const imageCache = Cache.getInstance<string, ItemImages>(
  'jellyfin-images',
  50_000
);
const IMAGE_TTL = 7 * 24 * 3600;

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function fromB64url(text: string): string | null {
  try {
    return Buffer.from(text, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

const SIGNATURE_LENGTH = 11;

function signTag(body: string): string {
  return createHmac('sha256', appConfig.bootstrap.secretKey)
    .update(`jellyfin-image:${body}`)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

export function encodeImageTag(url: string): string {
  const match = [...HOST_PREFIXES]
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, prefix]) => url.startsWith(prefix));
  const body = match
    ? `${match[0]}${b64url(url.slice(match[1].length))}`
    : `0${b64url(url)}`;
  return `${signTag(body)}${body}`;
}

export function decodeImageTag(tag: string): string | null {
  if (!tag || tag.length < SIGNATURE_LENGTH + 2) return null;
  const body = tag.slice(SIGNATURE_LENGTH);
  if (!constantTimeEquals(tag.slice(0, SIGNATURE_LENGTH), signTag(body)))
    return null;
  const code = body[0];
  const rest = fromB64url(body.slice(1));
  if (rest === null) return null;
  const url =
    code === '0'
      ? rest
      : (HOST_PREFIXES.find(([c]) => c === code)?.[1] ?? '') + rest;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

export function imageTagsFor(images: ItemImages): {
  ImageTags: Partial<Record<ImageKind, string>>;
  BackdropImageTags: string[];
} {
  const ImageTags: Partial<Record<ImageKind, string>> = {};
  if (images.Primary) ImageTags.Primary = encodeImageTag(images.Primary);
  if (images.Logo) ImageTags.Logo = encodeImageTag(images.Logo);
  if (images.Thumb) ImageTags.Thumb = encodeImageTag(images.Thumb);
  return {
    ImageTags,
    BackdropImageTags: images.Backdrop ? [encodeImageTag(images.Backdrop)] : [],
  };
}

/** Fallback for clients that request an image without its tag. */
export function rememberImages(itemId: string, images: ItemImages): void {
  if (!images.Primary && !images.Backdrop && !images.Logo && !images.Thumb)
    return;
  void imageCache.set(itemId, images, IMAGE_TTL).catch(() => undefined);
}

export function recallImages(itemId: string): Promise<ItemImages | undefined> {
  return imageCache.get(itemId).catch(() => undefined);
}

export function pickImage(
  images: ItemImages | undefined,
  type: string
): string | null {
  if (!images) return null;
  switch (type.toLowerCase()) {
    case 'primary':
      return images.Primary ?? images.Thumb ?? images.Backdrop ?? null;
    case 'backdrop':
    case 'art':
    case 'banner':
      return images.Backdrop ?? images.Thumb ?? images.Primary ?? null;
    case 'thumb':
      return images.Thumb ?? images.Backdrop ?? images.Primary ?? null;
    case 'logo':
      return images.Logo ?? null;
    default:
      return images.Primary ?? null;
  }
}
