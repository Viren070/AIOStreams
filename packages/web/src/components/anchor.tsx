import React from 'react';
import { currentHost } from '../lib/hosts';
import { navigate } from '../lib/paths';

/**
 * A link whose address sits in `data-href` on TVs, as the web view watches
 * every link with an intersection observer (see lib/use-in-view.ts).
 */
export const Anchor = React.forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement>
>(function Anchor({ href, onClick, ...props }, ref) {
  if (!href || !currentHost().tv)
    return <a ref={ref} href={href} onClick={onClick} {...props} />;
  return (
    <a
      ref={ref}
      role="link"
      tabIndex={0}
      data-href={href}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (href.startsWith('#/')) navigate(href.slice(1));
        else window.open(href, props.target ?? '_self');
      }}
    />
  );
});
