import React from 'react';
import { createPortal } from 'react-dom';
import { themeVariables } from '@aiostreams/ui/utils/palette';
import { settings, useSetting, CUSTOM_CSS_OFF } from '../lib/settings';
import { useServerInfo } from '../lib/server-info';

/** Last on the page, so the user's colours and CSS win ties. */
export function ThemeStyles() {
  const [colors] = useSetting(settings.theme.colors);
  const [css] = useSetting(settings.theme.customCss);
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

/** The server's CSS, in the head so the user's own after it wins ties. */
export function ServerStyles() {
  const { css } = useServerInfo();
  const [on] = useSetting(settings.theme.serverCss);
  if (!css || !on || CUSTOM_CSS_OFF) return null;
  return createPortal(<style data-ui="server-css">{css}</style>, document.head);
}
