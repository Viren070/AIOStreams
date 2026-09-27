import React from 'react';
import { createPortal } from 'react-dom';
import { themeVariables } from '@aiostreams/ui/utils/palette';
import { CUSTOM_CSS_OFF, useCustomCss, useThemeColors } from '../lib/settings';

/** Last on the page, so the user's colours and CSS win ties. */
export function ThemeStyles() {
  const [colors] = useThemeColors();
  const [css] = useCustomCss();
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
