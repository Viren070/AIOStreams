import React from 'react';
import { useServerInfo } from '../lib/server-info';
import { CachedImage } from './cached-image';

/** The configuration's logo, or the product's when it has none or it fails. */
export function BrandLogo({ className }: { className?: string }) {
  const { name, logo } = useServerInfo();
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [logo]);
  return (
    <CachedImage
      data-ui="brand-logo"
      src={logo && !failed ? logo : __STANDALONE__ ? './logo.png' : '/logo.png'}
      alt={name ?? 'AIOStreams'}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
