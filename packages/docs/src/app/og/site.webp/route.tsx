import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'takumi-js/response';
import { ogBrand, ogLogo } from '@/lib/og';

export const revalidate = false;

const hero = `data:image/webp;base64,${readFileSync(
  join(process.cwd(), 'public', 'apps', 'hero.webp')
).toString('base64')}`;

/** Link preview for the pages with no card of their own, such as home and /download. */
export function GET() {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        color: 'white',
        backgroundColor: ogBrand.background,
        backgroundImage: `radial-gradient(ellipse 80% 70% at 75% 0%, ${ogBrand.wash}, transparent)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '28px',
          width: '480px',
          padding: '0 0 0 64px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '18px',
          }}
        >
          <img src={ogLogo} width={60} height={60} alt="" />
          <p style={{ fontSize: '54px', fontWeight: 700, margin: 0 }}>
            AIOStreams
          </p>
        </div>
        <p
          style={{
            fontSize: '40px',
            fontWeight: 700,
            lineHeight: 1.2,
            margin: 0,
          }}
        >
          Your addons, debrid services and Usenet in one list
        </p>
        <p
          style={{
            fontSize: '26px',
            lineHeight: 1.35,
            margin: 0,
            color: 'rgba(240,240,240,0.7)',
          }}
        >
          In Stremio, or the AIOStreams app on your computer, phone and TV
        </p>
      </div>
      <img
        src={hero}
        alt=""
        style={{
          position: 'absolute',
          left: '500px',
          top: '78px',
          width: '680px',
          height: '463px',
        }}
      />
    </div>,
    { width: 1200, height: 630, format: 'webp' }
  );
}
