import type { ImageAssetMeta } from '../types';

/**
 * Runtime registry for decoded image assets.
 *
 * The store only keeps {@link ImageAssetMeta} (plain JSON). Everything that
 * costs memory — the Object URL, the ImageBitmap / HTMLImageElement — lives
 * here and must be released explicitly:
 *
 * - replacing or removing an asset → `release(id)`
 * - "reset project" / leaving the editor / closing the page → `clear()`
 *
 * The registry is a module singleton on purpose: the preview rasteriser and the
 * MP4 compositor must draw the exact same bitmap, and the exporter runs outside
 * React.
 *
 * NOTE: image assets do **not** create THREE textures. They are 2D layers only;
 * the product material keeps owning its own textures (see DECISIONS D13).
 */

export interface ImageEntry {
  meta: ImageAssetMeta;
  /** Object URL of the blob actually decoded; revoked on release. */
  url: string;
  bitmap: ImageBitmap | null;
  /** Fallback when `createImageBitmap` is unavailable. */
  element: HTMLImageElement | null;
}

export interface RegistryStats {
  entries: number;
  urlsCreated: number;
  urlsRevoked: number;
  bitmapsClosed: number;
}

class ImageAssetRegistry {
  private entries = new Map<string, ImageEntry>();
  private urlsCreated = 0;
  private urlsRevoked = 0;
  private bitmapsClosed = 0;

  /** Bumped on every change so the preview can repaint without subscriptions. */
  version = 0;

  /**
   * Every Object URL in this module goes through here so creation and
   * revocation can be counted (`/lab` diagnostics, e2e assertions).
   */
  createUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urlsCreated += 1;
    this.version += 1;
    return url;
  }

  revokeUrl(url: string): void {
    try {
      URL.revokeObjectURL(url);
      this.urlsRevoked += 1;
    } catch {
      // revoking twice is harmless; cleanup must never throw
    }
  }

  put(entry: ImageEntry): void {
    // Same id means the previous bitmap must die first.
    this.release(entry.meta.id, { silent: true });
    this.entries.set(entry.meta.id, entry);
    this.version += 1;
  }

  get(id: string): ImageEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  meta(id: string): ImageAssetMeta | null {
    return this.entries.get(id)?.meta ?? null;
  }

  /** Ready-to-draw source, or null when the asset is missing/not decoded. */
  source = (id: string): CanvasImageSource | null => {
    const entry = this.entries.get(id);
    if (!entry) return null;
    return entry.bitmap ?? entry.element;
  };

  release(id: string, options: { silent?: boolean } = {}): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);

    this.revokeUrl(entry.url);
    if (entry.bitmap) {
      try {
        entry.bitmap.close();
        this.bitmapsClosed += 1;
      } catch {
        // already closed
      }
      entry.bitmap = null;
    }
    if (entry.element) {
      entry.element.src = '';
      entry.element = null;
    }
    if (!options.silent) this.version += 1;
    return true;
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.release(id, { silent: true });
    this.version += 1;
  }

  size(): number {
    return this.entries.size;
  }

  stats(): RegistryStats {
    return {
      entries: this.entries.size,
      urlsCreated: this.urlsCreated,
      urlsRevoked: this.urlsRevoked,
      bitmapsClosed: this.bitmapsClosed,
    };
  }

  /** Test-only hook: resets counters (not the entries). */
  resetStatsForTest(): void {
    this.urlsCreated = 0;
    this.urlsRevoked = 0;
    this.bitmapsClosed = 0;
  }
}

export const imageRegistry = new ImageAssetRegistry();
