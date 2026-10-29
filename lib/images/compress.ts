import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const MAX_PHOTO_SIDE = 1600;
export const PHOTO_QUALITY = 0.75;

/**
 * Scales a photo down so its longest side is at most 1600 px and re-encodes
 * it as JPEG (quality 0.75). A 12 MP phone photo (~3–5 MB) ends up around
 * 200–400 KB. Works on native and web (canvas); on iPhone Safari this also
 * turns HEIC into JPEG.
 */
export async function compressPhoto(source: { uri: string; width?: number; height?: number }) {
  const w = source.width ?? 0;
  const h = source.height ?? 0;
  const context = ImageManipulator.manipulate(source.uri);
  if (w > MAX_PHOTO_SIDE || h > MAX_PHOTO_SIDE || !w || !h) {
    context.resize(w >= h ? { width: MAX_PHOTO_SIDE } : { height: MAX_PHOTO_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}
