import React from 'react';
import { themeVariables } from '@aiostreams/ui/utils/palette';
import { useCustomCss, useThemeColors } from '../lib/settings';

/** The user's colours and CSS, over the stylesheet's. */
export function ThemeStyles() {
  const [colors] = useThemeColors();
  const [css] = useCustomCss();
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    const vars = themeVariables(colors);
    for (const [name, value] of Object.entries(vars))
      root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
    };
  }, [colors]);
  return css ? <style data-ui="custom-css">{css}</style> : null;
}
