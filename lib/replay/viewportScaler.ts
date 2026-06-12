import type { Replayer } from "rrweb";

/**
 * Scales the recording's native resolution to fit a container element,
 * centering the content. Modeled on PostHog's
 * common/replay-headless/src/viewport-scaler.ts, adapted to fit an
 * arbitrary container instead of the window (our player lives in a panel,
 * not fullscreen).
 */
export class ViewportScaler {
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(
    private contentEl: HTMLElement,
    private containerEl: HTMLElement
  ) {}

  apply(recWidth: number, recHeight: number): void {
    const availW = this.containerEl.clientWidth;
    const availH = this.containerEl.clientHeight;
    if (recWidth <= 0 || recHeight <= 0 || availW <= 0 || availH <= 0) {
      return;
    }
    this.lastWidth = recWidth;
    this.lastHeight = recHeight;

    const scale = Math.min(availW / recWidth, availH / recHeight);
    const offsetX = (availW - recWidth * scale) / 2;
    const offsetY = (availH - recHeight * scale) / 2;
    // Clip the content element to the recording's native size, then scale
    // it down and center within the container.
    this.contentEl.style.width = `${recWidth}px`;
    this.contentEl.style.height = `${recHeight}px`;
    this.contentEl.style.overflow = "hidden";
    this.contentEl.style.transformOrigin = "top left";
    this.contentEl.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  /** Re-applies the last known recording size (e.g. after a container resize). */
  reapply(): void {
    if (this.lastWidth > 0 && this.lastHeight > 0) {
      this.apply(this.lastWidth, this.lastHeight);
    }
  }

  attachToReplayer(replayer: Replayer): void {
    const iframeWidth = Number.parseFloat(replayer.iframe.width ?? "");
    const iframeHeight = Number.parseFloat(replayer.iframe.height ?? "");
    if (iframeWidth > 0 && iframeHeight > 0) {
      this.apply(iframeWidth, iframeHeight);
    }

    replayer.on("resize", (dimension) => {
      const { width, height } = dimension as { width: number; height: number };
      this.apply(width, height);
    });
  }
}
