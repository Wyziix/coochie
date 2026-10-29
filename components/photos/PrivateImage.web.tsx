import { Image, type ImageProps } from 'expo-image';
import { useEffect, useState } from 'react';

type Props = Omit<ImageProps, 'source'> & { uri: string | null };

/**
 * Web: download the signed URL into memory (no browser cache) and show it as a
 * blob: URL, which is thrown away when the photo unmounts (e.g. on re-lock).
 * Being same-origin, blob: images also keep working under strict
 * cross-origin isolation headers (COEP), which offline mode may need.
 */
export function PrivateImage({ uri, ...props }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!uri) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(uri, { cache: 'no-store' })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBlobUrl(null);
    };
  }, [uri]);

  if (!blobUrl) return null;
  return <Image {...props} source={{ uri: blobUrl }} cachePolicy="none" />;
}
