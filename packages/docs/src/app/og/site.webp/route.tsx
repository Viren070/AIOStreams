import { ImageResponse } from '@takumi-rs/image-response';
import { generate as DefaultImage } from 'fumadocs-ui/og/takumi';
import { ogBrand, ogLogo } from '@/lib/og';

export const revalidate = false;

/** Link preview for the pages with no page-specific card: home and /changelog. */
export function GET() {
  return new ImageResponse(
    <DefaultImage
      title="AIOStreams"
      description="Combine, filter, sort, and customise streams from every source."
      site="Documentation"
      icon={<img src={ogLogo} width={56} height={56} alt="" />}
      primaryColor={ogBrand.wash}
      primaryTextColor={ogBrand.primaryText}
    />,
    { width: 1200, height: 630, format: 'webp' }
  );
}
