export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `mediaTime` is in seconds. */
export interface ShownFrame {
  mediaTime: number;
  width: number;
  height: number;
}

export interface PictureSurface {
  /** In the page's pixels. */
  box(): Box;
  zIndex(): string;
  /** Over the picture and under the controls. */
  insert(canvas: HTMLCanvasElement): void;
  frames(shown: (frame: ShownFrame) => void): () => void;
  /** A new frame size isn't a move; layers check that per frame. */
  watch(moved: () => void): () => void;
}

export interface SubtitleLayer {
  /** Shows the lines this much later. */
  setDelay(ms: number): void;
  /** Percent of the height from the bottom where lines the file leaves unplaced sit. */
  setHeight(percent: number): void;
  /** After a move the surface doesn't watch. */
  place(): void;
  destroy(): void;
}

export function pictureBox(video: HTMLVideoElement, w: number, h: number): Box {
  const r = video.getBoundingClientRect();
  const box = { x: r.left, y: r.top, width: r.width, height: r.height };
  const fit = getComputedStyle(video).objectFit;
  if (!w || !h || fit === 'fill') return box;
  const scale = (fit === 'cover' ? Math.max : Math.min)(
    r.width / w,
    r.height / h
  );
  return {
    x: r.left + (r.width - w * scale) / 2,
    y: r.top + (r.height - h * scale) / 2,
    width: w * scale,
    height: h * scale,
  };
}

export function videoSurface(video: HTMLVideoElement): PictureSurface {
  return {
    box: () => pictureBox(video, video.videoWidth, video.videoHeight),
    zIndex: () => getComputedStyle(video).zIndex,
    insert: (canvas) => video.after(canvas),
    frames(shown) {
      let callback: number | undefined;
      let lastFrame = -Infinity;
      let active = true;
      const onFrame: VideoFrameRequestCallback = (now, frame) => {
        lastFrame = now;
        shown(frame);
        if (active) callback = video.requestVideoFrameCallback(onFrame);
      };
      // webOS can play on a hardware video plane without firing frame callbacks.
      const fromClock = () => {
        if (
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          !video.seeking
        )
          shown({
            mediaTime: video.currentTime,
            width: video.videoWidth,
            height: video.videoHeight,
          });
      };
      const onTime = () => {
        if (performance.now() - lastFrame >= 250) fromClock();
      };
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('loadeddata', fromClock);
      video.addEventListener('seeked', fromClock);
      callback = video.requestVideoFrameCallback?.(onFrame);
      // Subscribers finish initializing their layer before its first notification.
      queueMicrotask(() => {
        if (active) onTime();
      });
      return () => {
        active = false;
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('loadeddata', fromClock);
        video.removeEventListener('seeked', fromClock);
        if (callback !== undefined) video.cancelVideoFrameCallback(callback);
      };
    },
    watch(moved) {
      const resize = new ResizeObserver(moved);
      resize.observe(video);
      video.addEventListener('resize', moved);
      return () => {
        resize.disconnect();
        video.removeEventListener('resize', moved);
      };
    },
  };
}

/** `box` is where it was last placed; `moved` hears each move but the first. */
export function overlayCanvas(surface: PictureSurface, moved?: () => void) {
  const canvas = document.createElement('canvas');
  canvas.dataset.ui = 'subtitles';
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    pointerEvents: 'none',
  });
  surface.insert(canvas);
  let placed = '';
  let box = surface.box();
  let shift = { x: 0, y: 0 };
  const place = () => {
    box = surface.box();
    // A transformed ancestor, as the mini player's frame is, holds a fixed canvas instead of the window.
    const held = canvas.getBoundingClientRect();
    const x = box.x - (held.left - shift.x);
    const y = box.y - (held.top - shift.y);
    const { width, height } = box;
    const key = `${x},${y},${width},${height}`;
    if (key === placed) return;
    placed = key;
    shift = { x, y };
    Object.assign(canvas.style, {
      transform: `translate(${x}px, ${y}px)`,
      width: `${width}px`,
      height: `${height}px`,
      zIndex: surface.zIndex(),
    });
    if (ready) moved?.();
  };
  let ready = false;
  place();
  ready = true;
  return {
    canvas,
    place,
    box: () => box,
    unwatch: surface.watch(place),
  };
}
