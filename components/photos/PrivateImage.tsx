import { Image, type ImageProps } from 'expo-image';

type Props = Omit<ImageProps, 'source'> & { uri: string | null };

/** A locked progress photo: never written to the image cache on disk. */
export function PrivateImage({ uri, ...props }: Props) {
  if (!uri) return null;
  return <Image {...props} source={{ uri }} cachePolicy="none" />;
}
