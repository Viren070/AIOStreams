import { notFound } from 'next/navigation';
import { ImageResponse } from '@takumi-rs/image-response';
import { changelogSource, formatChangelogDate } from '@/lib/source';
import { ogBrand, ogLogo } from '@/lib/og';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<'/og/changelog/[slug]'>
) {
  const { slug } = await params;
  const page = changelogSource.getPage([slug.replace(/\.webp$/, '')]);
  if (!page) notFound();

  const { title, description, version, date } = page.data;

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '4rem',
        color: 'white',
        backgroundColor: ogBrand.background,
        backgroundImage: `linear-gradient(to top right, ${ogBrand.wash}, transparent)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '20px',
          color: ogBrand.primaryText,
        }}
      >
        <img src={ogLogo} width={56} height={56} alt="" />
        <p style={{ fontSize: '48px', fontWeight: 600, margin: 0 }}>
          AIOStreams
        </p>
        <p
          style={{
            fontSize: '28px',
            fontWeight: 600,
            margin: 0,
            padding: '6px 20px',
            borderRadius: '999px',
            color: 'rgba(240,240,240,0.9)',
            backgroundColor: 'rgba(255,255,255,0.12)',
          }}
        >
          Changelog
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexGrow: 1,
          gap: '20px',
        }}
      >
        <p style={{ fontWeight: 800, fontSize: '76px', margin: 0 }}>{title}</p>
        {description ? (
          <p
            style={{
              fontSize: '34px',
              lineHeight: 1.3,
              margin: 0,
              color: 'rgba(240,240,240,0.75)',
            }}
          >
            {truncate(description, 130)}
          </p>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '20px',
          fontSize: '32px',
          color: 'rgba(240,240,240,0.6)',
        }}
      >
        <p
          style={{
            margin: 0,
            padding: '8px 24px',
            borderRadius: '999px',
            fontWeight: 700,
            color: 'white',
            backgroundColor: ogBrand.primary,
          }}
        >
          {version ?? slug}
        </p>
        <p style={{ margin: 0 }}>{formatChangelogDate(date)}</p>
      </div>
    </div>,
    { width: 1200, height: 630, format: 'webp' }
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max).trimEnd()}…`;
}

export function generateStaticParams() {
  return changelogSource.getPages().map((page) => ({
    slug: `${page.slugs[0]}.webp`,
  }));
}
