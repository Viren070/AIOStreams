import React from 'react';
import { encode } from 'uqr';

/** A QR code of `text`, dark on light so phones read it at a distance. */
export function QrCode({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const path = React.useMemo(() => {
    const { data } = encode(text, { ecc: 'M', border: 2 });
    let d = '';
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        // eslint-disable-next-line lingui/no-unlocalized-strings -- SVG path data
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      })
    );
    return { d, size: data.length };
  }, [text]);
  return (
    <svg
      data-ui="party-qr"
      viewBox={`0 0 ${path.size} ${path.size}`}
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label="QR code of the invite"
    >
      <rect width={path.size} height={path.size} fill="white" />
      <path d={path.d} fill="black" />
    </svg>
  );
}
