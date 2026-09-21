import { Link } from '@tanstack/react-router';
import { Card } from '@/components/ui/card';
import { NAV, SECTIONED, sectionHref } from '@/app/dashboard/nav';

const CHIP_CLASS =
  'relative rounded-md border border-[--border] bg-[--subtle]/50 px-2 py-1 ' +
  'text-[11px] font-medium text-[--muted] transition-colors ' +
  'hover:border-[--muted]/50 hover:text-[--foreground]';

/**
 * Quick links to every dashboard section, derived from the sidebar's `NAV` so
 * a new menu appears here without a second edit.
 */
export function SectionLinks() {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">Sections</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {NAV.filter((n) => n.href !== '/dashboard').map((n) => {
          const Icon = n.icon;
          const sections = SECTIONED[n.href];
          return (
            <Card
              key={n.href}
              className="group relative p-4 transition-colors hover:border-[--muted]/40 hover:bg-[--subtle]/50"
            >
              <Link
                to={n.href}
                className="flex items-center gap-2 font-medium before:absolute before:inset-0 before:rounded-xl before:content-[''] focus-visible:outline-none"
              >
                <Icon className="text-[--muted] transition-colors group-hover:text-[--foreground]" />
                {n.label}
              </Link>
              {sections ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sections.map((s) => (
                    <Link
                      key={s.id}
                      to={sectionHref(n.href, s.id)}
                      className={CHIP_CLASS}
                    >
                      {s.label}
                    </Link>
                  ))}
                </div>
              ) : (
                n.desc && (
                  <p className="mt-2 text-xs text-[--muted]">{n.desc}</p>
                )
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
