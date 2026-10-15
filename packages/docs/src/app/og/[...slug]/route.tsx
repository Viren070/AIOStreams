import { getPageImage, source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'takumi-js/response';
import { generate as DefaultImage } from 'fumadocs-ui/og/takumi';
import { ogBrand, ogLogo } from '@/lib/og';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<'/og/[...slug]'>
) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return new ImageResponse(
    <DefaultImage
      title={page.data.title}
      description={page.data.description}
      site="AIOStreams"
      icon={<img src={ogLogo} width={56} height={56} alt="" />}
      primaryColor={ogBrand.wash}
      primaryTextColor={ogBrand.primaryText}
    />,
    {
      width: 1200,
      height: 630,
      format: 'webp',
    }
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }));
}
