import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

import { Text } from './Text';

export type AvatarProps = {
  uri?: string | null;
  name?: string | null;
  size?: number;
};

export function initialsOf(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts.slice(0, 1);
  return letters.map((p) => p!.charAt(0).toUpperCase()).join('') || '?';
}

export function Avatar({ uri, name, size = 72 }: AvatarProps) {
  const theme = useTheme();
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[shape, { backgroundColor: theme.colors.surfaceAlt }]}
        contentFit="cover"
        accessibilityLabel={name ? `${name}'s avatar` : 'Avatar'}
      />
    );
  }

  return (
    <View
      accessibilityLabel={name ? `${name}'s avatar` : 'Avatar'}
      style={[shape, styles.fallback, { backgroundColor: theme.colors.surfaceAlt }]}
    >
      <Text variant="heading" color="textMuted" style={{ fontSize: size * 0.36 }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
