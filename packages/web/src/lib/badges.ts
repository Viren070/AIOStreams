import {
  isField,
  textMatcher,
  toRegExp,
  type Matcher,
  type VersionField,
  type VersionText,
} from './versions';

export interface Badge {
  label: string;
  /** A regular expression, matched without regard to case. */
  match: string;
  /** Shown in place of the label. */
  image?: string;
  color?: string;
  background?: string;
  border?: string;
  /** Badges sharing a group are alternatives: only the first match shows. */
  group?: string;
  /** Only these parts of the version are matched; otherwise all of it. */
  fields?: VersionField[];
}

export interface BadgeSettings {
  links: string[];
  badges: Badge[];
}

export interface CompiledBadge {
  badge: Badge;
  test: Matcher;
  keys: string[];
}

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const COLOR =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent|rgba?\([\d\s.,%/]+\))$/i;

const color = (value: unknown) => {
  const found = text(value);
  return found && COLOR.test(found) ? found : undefined;
};

const link = (value: unknown) => {
  const found = text(value);
  return found && /^https?:\/\//i.test(found) ? found : undefined;
};

/** Drops the fields left unset, so saved badges stay small. */
function compact(badge: Badge): Badge {
  return Object.fromEntries(
    Object.entries(badge).filter(([, value]) => value !== undefined)
  ) as unknown as Badge;
}

function ownBadge(value: unknown): Badge | null {
  if (!isObject(value)) return null;
  const label = text(value.label);
  const match = text(value.match);
  if (!label || !match) return null;
  const named = Array.isArray(value.fields) ? value.fields : [];
  const fields = named.filter(isField);
  // A badge naming only fields this app lacks would otherwise match everything.
  if (named.length && !fields.length) return null;
  return compact({
    label,
    match,
    image: link(value.image),
    color: color(value.color),
    background: color(value.background),
    border: color(value.border),
    group: text(value.group),
    fields: fields.length ? fields : undefined,
  });
}

/** Fusion writes eight-digit colours alpha first. */
function fusionColor(value: unknown): string | undefined {
  const found = text(value);
  const argb = found?.match(/^#([0-9a-f]{2})([0-9a-f]{6})$/i);
  return argb ? `#${argb[2]}${argb[1]}` : color(found);
}

/** One of Fusion's filters, the format Nuvio reads too. */
function fusionBadge(value: unknown): Badge | null {
  if (!isObject(value) || value.isEnabled === false) return null;
  const label = text(value.name);
  const match = text(value.pattern);
  if (!label || !match) return null;
  const filled = text(value.tagStyle)?.toLowerCase().startsWith('filled');
  return compact({
    label,
    match,
    image: link(value.imageURL),
    color: fusionColor(value.textColor),
    background: filled ? fusionColor(value.tagColor) : undefined,
    border: fusionColor(value.borderColor),
  });
}

const all = (values: unknown[], read: (value: unknown) => Badge | null) =>
  values.map(read).filter((badge): badge is Badge => !!badge);

/**
 * Badges in this app's format or Fusion's, or the active import of Nuvio's
 * saved settings. Null when the data holds none of them.
 */
export function readBadges(data: unknown): Badge[] | null {
  if (Array.isArray(data)) {
    const found = data.flatMap((entry) => readBadges(entry) ?? []);
    return found.length ? found : null;
  }
  if (!isObject(data)) return null;
  if (Array.isArray(data.badges)) return all(data.badges, ownBadge);
  if (Array.isArray(data.filters)) return all(data.filters, fusionBadge);
  const rules = isObject(data.settings)
    ? data.settings.streamBadgeRules
    : data.streamBadgeRules;
  const imports = isObject(rules) ? rules.imports : data.imports;
  if (Array.isArray(imports)) {
    const active =
      imports.find((entry) => isObject(entry) && entry.isActive !== false) ??
      imports[0];
    return isObject(active) && Array.isArray(active.filters)
      ? all(active.filters, fusionBadge)
      : null;
  }
  const one = ownBadge(data) ?? fusionBadge(data);
  return one && [one];
}

export function readBadgeSettings(raw: string | undefined): BadgeSettings {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isObject(parsed)) return { links: [], badges: [] };
    return {
      links: Array.isArray(parsed.links)
        ? parsed.links.map(link).filter((l): l is string => !!l)
        : [],
      badges: Array.isArray(parsed.badges) ? all(parsed.badges, ownBadge) : [],
    };
  } catch {
    return { links: [], badges: [] };
  }
}

/** A pattern this browser cannot compile is left out. */
export function compileBadges(badges: Badge[]): CompiledBadge[] {
  return badges.flatMap((badge) => {
    const regex = toRegExp(badge.match);
    return regex
      ? [
          {
            badge,
            test: textMatcher(regex, badge.fields),
            keys: [
              badge.label.toLowerCase(),
              ...(badge.image ? [badge.image] : []),
            ],
          },
        ]
      : [];
  });
}

/** In list order, skipping a repeated label or image, and the first of each group. */
export function matchBadges(
  text: VersionText,
  compiled: CompiledBadge[]
): Badge[] {
  const seen = new Set<string>();
  const groups = new Set<string>();
  const shown: Badge[] = [];
  for (const { badge, test, keys } of compiled) {
    if (keys.some((key) => seen.has(key))) continue;
    if (badge.group && groups.has(badge.group)) continue;
    if (!test(text)) continue;
    for (const key of keys) seen.add(key);
    if (badge.group) groups.add(badge.group);
    shown.push(badge);
  }
  return shown;
}
