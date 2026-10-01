import React from 'react';
import { createPortal } from 'react-dom';
import { themeVariables } from '@aiostreams/ui/utils/palette';
import { settings, useSetting, CUSTOM_CSS_OFF } from '../lib/settings';

/** Last on the page, so the user's colours and CSS win ties. */
export function ThemeStyles() {
  const [colors] = useSetting(settings.themeColors);
  const [css] = useSetting(settings.customCss);
  const vars = React.useMemo(
    () =>
      Object.entries(themeVariables(colors))
        .map(([name, value]) => `${name}: ${value};`)
        .join(' '),
    [colors]
  );
  return createPortal(
    <>
      {vars && <style data-ui="theme-colors">{`:root { ${vars} }`}</style>}
      {css && !CUSTOM_CSS_OFF && <style data-ui="custom-css">{css}</style>}
    </>,
    document.body
  );
}
