import React from 'react';
import { t } from '@lingui/core/macro';
import { formatLocale } from '@/lib/i18n';
import { dateFormat } from '@/lib/format';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { Section } from './section';

const WEEKDAYS: NonNullable<BaseItemDto['AirDays']> = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** When a series airs, in the app's language: `Every Sunday at 21:00`. */
function airsLine(
  days: BaseItemDto['AirDays'],
  time: string | null | undefined
): string | null {
  if (!days?.length) return null;
  const names = days.map((day) =>
    // 1 January 2023 was a Sunday.
    dateFormat({ weekday: 'long' }).format(
      new Date(2023, 0, 1 + WEEKDAYS.indexOf(day))
    )
  );
  const list = new Intl.ListFormat(formatLocale(), {
    type: 'conjunction',
  }).format(names);
  return time ? t`Every ${list} at ${time}` : t`Every ${list}`;
}

export function Details({ item }: { item: BaseItemDto }) {
  const airs = airsLine(item.AirDays, item.AirTime);
  const released = item.PremiereDate
    ? dateFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(item.PremiereDate)
      )
    : null;
  const rows: [string, string, React.ReactNode][] = (
    [
      ['studios', t`Studios`, item.Studios?.map((s) => s.Name).join(', ')],
      [
        'released',
        item.Type === 'Series' ? t`First aired` : t`Released`,
        released,
      ],
      [
        'airs',
        t`Airs`,
        item.Type === 'Series' && item.Status === 'Continuing' ? airs : null,
      ],
      ['country', t`Country`, item.ProductionLocations?.join(', ')],
    ] as [string, string, React.ReactNode][]
  ).filter(([, , value]) => !!value);
  if (!rows.length) return null;
  return (
    <Section name="details" title={t`Details`}>
      <dl
        data-ui="item-details"
        className="grid max-w-5xl grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {rows.map(([name, label, value]) => (
          <div key={name} data-ui="item-detail" data-name={name}>
            <dt className="text-xs uppercase tracking-wide text-[--muted]">
              {label}
            </dt>
            <dd className="mt-1 text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
