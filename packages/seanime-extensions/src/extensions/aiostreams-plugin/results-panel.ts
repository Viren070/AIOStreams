import { RESULTS_HTML } from './webview';
import { WebviewState } from './types';

interface PanelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const ANIM_MS = 280;
const VP_WIDTH = 520;
const MOBILE_BREAKPOINT = 768;
const SUPPRESS_OUTSIDE_CLOSE_MS = 250;
const POST_RESIZE_SHOW_DELAY_MS = 150;

export class ResultsPanel {
  readonly wvState: $ui.State<WebviewState>;
  readonly mobileState: $ui.State<boolean>;
  private readonly webview: $ui.Webview;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private lastAppliedMobile = false;
  private pendingHideCancel: (() => void) | null = null;
  private suppressOutsideCloseUntil = 0;

  constructor(
    private readonly ctx: $ui.Context,
    initialState: WebviewState
  ) {
    this.wvState = ctx.state<WebviewState>(initialState);
    this.mobileState = ctx.state<boolean>(false);
    this.webview = ctx.newWebview({
      slot: 'fixed',
      width: `${VP_WIDTH}px`,
      height: '98vh',
      hidden: true,
      zIndex: 100000,
      style: `color-scheme: dark; background: transparent; left: calc(100vw - ${VP_WIDTH}px - 10px); top: 10px`,
      window: {
        defaultPosition: 'top-right',
        frameless: true,
      },
    });
    this.webview.setContent(() => RESULTS_HTML);
    this.webview.channel.sync('state', this.wvState);
    this.webview.channel.sync('mobile-mode', this.mobileState);

    try {
      const size = ctx.dom.viewport.getSize();
      this.viewportWidth = size.width;
      this.viewportHeight = size.height;
    } catch {}

    try {
      ctx.dom.viewport.onResize((size) => {
        this.viewportWidth = size.width;
        this.viewportHeight = size.height;
        this.applyViewportSize();
      });
    } catch {}

    try {
      ctx.dom.observe('body', (elements) => {
        for (const el of elements) {
          if (el.attributes['data-aio-outside-click']) continue;
          el.setAttribute('data-aio-outside-click', '1');
          el.addEventListener('click', (event) =>
            this.handleOutsideClick(event)
          );
        }
      });
    } catch {}

    ctx.screen.onNavigate((e) => {
      if (e.pathname !== '/entry') this.hide();
    });
  }

  get channel(): $ui.Webview['channel'] {
    return this.webview.channel;
  }

  isHidden(): boolean {
    return this.webview.isHidden();
  }

  private isMobileViewport(): boolean {
    return this.viewportWidth < MOBILE_BREAKPOINT;
  }

  // Returns true if setOptions was actually called. Callers that follow up with
  // show() use the return value to wait for the iframe to re-render at the new
  // size before revealing it.
  private applyViewportSize(): boolean {
    const mobile = this.isMobileViewport();
    if (mobile === this.lastAppliedMobile) return false;
    this.lastAppliedMobile = mobile;
    this.mobileState.set(mobile);
    try {
      this.webview.setOptions(
        mobile
          ? {
              width: 'calc(100vw - 20px)',
              height: '95dvh',
              style:
                'color-scheme: dark; background: transparent; left: 10px; top: calc(100dvh - 95dvh)',
              window: { frameless: true, defaultPosition: 'bottom-left' },
            }
          : {
              width: `${VP_WIDTH}px`,
              height: '98vh',
              style: `color-scheme: dark; background: transparent; left: calc(100vw - ${VP_WIDTH}px - 10px); top: 10px`,
              window: { frameless: true, defaultPosition: 'top-right' },
            }
      );
    } catch {}
    return true;
  }

  private getPanelRect(): PanelRect {
    const width = this.lastAppliedMobile
      ? Math.max(this.viewportWidth - 20, 0)
      : VP_WIDTH;
    const height = this.lastAppliedMobile
      ? Math.max(Math.round(this.viewportHeight * 0.95), 0)
      : Math.max(Math.round(this.viewportHeight * 0.98), 0);
    const left = this.lastAppliedMobile
      ? 10
      : Math.max(this.viewportWidth - width - 10, 0);
    const top = this.lastAppliedMobile
      ? Math.max(this.viewportHeight - height, 0)
      : 10;
    return { left, top, right: left + width, bottom: top + height };
  }

  private handleOutsideClick(event: any): void {
    if (this.webview.isHidden()) return;
    if (Date.now() < this.suppressOutsideCloseUntil) return;

    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const rect = this.getPanelRect();
    const inside =
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    if (!inside) this.hide();
  }

  show(): void {
    if (this.pendingHideCancel) {
      this.pendingHideCancel();
      this.pendingHideCancel = null;
    }
    this.suppressOutsideCloseUntil = Date.now() + SUPPRESS_OUTSIDE_CLOSE_MS;
    if (this.applyViewportSize()) {
      this.ctx.setTimeout(() => this.webview.show(), POST_RESIZE_SHOW_DELAY_MS);
    } else {
      this.webview.show();
    }
  }

  hide(): void {
    if (this.pendingHideCancel) this.pendingHideCancel();
    this.webview.channel.send('close-anim', {});
    this.pendingHideCancel = this.ctx.setTimeout(() => {
      this.webview.hide();
      this.pendingHideCancel = null;
    }, ANIM_MS + 20);
  }

  sendPlayError(index: number): void {
    this.webview.channel.send('play-error', { index });
  }
}
