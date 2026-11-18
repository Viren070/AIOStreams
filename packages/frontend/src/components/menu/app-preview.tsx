import { ExternalLink } from 'lucide-react';
import home from '@/assets/app/home.webp';
import title from '@/assets/app/title.webp';

const SHOTS = [
  { src: home, caption: 'Your catalogs as a home screen' },
  { src: title, caption: 'Every title with its ratings, episodes and trailer' },
];

const LINKS = [
  { href: 'https://aiostreams.org', label: 'More about the app' },
  { href: 'https://aiostreams.org/download', label: 'Download' },
];

export function AppPreview() {
  return (
    <div className="space-y-3">
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible">
        {SHOTS.map((shot) => (
          <figure
            key={shot.caption}
            className="w-[80%] shrink-0 snap-start space-y-2 sm:w-auto"
          >
            <a href={shot.src} target="_blank" rel="noopener noreferrer">
              <img
                src={shot.src}
                alt={shot.caption}
                loading="lazy"
                decoding="async"
                className="aspect-[16/10] w-full rounded-lg border border-[--border] object-cover"
              />
            </a>
            <figcaption className="text-xs text-[--muted]">
              {shot.caption}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[--brand] hover:underline"
          >
            {link.label}
            <ExternalLink className="h-3 w-3" />
          </a>
        ))}
      </div>
    </div>
  );
}
