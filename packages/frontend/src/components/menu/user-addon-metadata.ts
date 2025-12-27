const DEFAULT_CATEGORY_COLOR = '#9ca3af';

const formatLabel = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => (word[0] ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ') || value;

type CategoryOption = { value: string; label: string; color: string };

export const USER_CATEGORY_OPTIONS: CategoryOption[] = [
  {
    value: 'metadata_catalog',
    label: 'Metadata & Catalog',
    color: '#3b82f6',
  },
  {
    value: 'subtitles',
    label: 'Subtitles',
    color: '#eab308',
  },
  {
    value: 'usenet_streams',
    label: 'Usenet Streams',
    color: '#06b6d4',
  },
  {
    value: 'debrid_streams',
    label: 'Debrid Streams',
    color: '#22c55e',
  },
  {
    value: 'other',
    label: 'Other',
    color: '#9ca3af',
  },
];

export type UserAddonCategory = string;

export const USER_CATEGORY_METADATA: Record<
  string,
  { label: string; color: string }
> = USER_CATEGORY_OPTIONS.reduce(
  (acc, option) => {
    acc[option.value] = { label: option.label, color: option.color };
    return acc;
  },
  {} as Record<string, { label: string; color: string }>
);

export const getUserCategoryOptions = (current?: string) => {
  const options = [...USER_CATEGORY_OPTIONS];
  if (current && !options.some((opt) => opt.value === current)) {
    options.push({
      value: current,
      label: formatLabel(current),
      color: DEFAULT_CATEGORY_COLOR,
    });
  }
  return options;
};

export const getUserCategoryMetadata = (category?: string) => {
  if (!category) return undefined;
  return (
    USER_CATEGORY_METADATA[category] || {
      label: formatLabel(category),
      color: DEFAULT_CATEGORY_COLOR,
    }
  );
};

type TagOption = { value: string; label: string };

export const USER_TAG_OPTIONS: TagOption[] = [
  { value: 'none', label: 'None' },
  { value: 'lifetime', label: 'Lifetime' },
  { value: 'free', label: 'Free' },
  { value: 'expires', label: 'Expires On...' },
];

export type UserTagType = string;

export const USER_TAG_LABELS: Record<string, string> = USER_TAG_OPTIONS.reduce(
  (acc, option) => {
    acc[option.value] = option.label;
    return acc;
  },
  {} as Record<string, string>
);

export const getUserTagOptions = (current?: string) => {
  const options = [...USER_TAG_OPTIONS];
  if (current && !options.some((opt) => opt.value === current)) {
    options.push({
      value: current,
      label: formatLabel(current),
    });
  }
  return options;
};

export const getUserTagLabel = (tagType?: string) => {
  if (!tagType) return USER_TAG_LABELS['none'] ?? 'None';
  return USER_TAG_LABELS[tagType] ?? formatLabel(tagType);
};

export const DEFAULT_USER_TAG = { type: 'none', expiryDate: '' };
