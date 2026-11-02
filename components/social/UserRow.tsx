import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { UserCard } from '@/lib/api/social';

/** Avatar, username and level (tap opens the profile); actions next to it, not inside. */
export function UserRow({
  user,
  children,
  note,
}: {
  user: Pick<UserCard, 'username' | 'avatar_url'> & { level?: number };
  children?: ReactNode;
  note?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${user.username}'s profile`}
        onPress={() =>
          router.push({ pathname: '/users/[username]', params: { username: user.username } })
        }
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          minHeight: 44,
        }}
      >
        <Avatar uri={user.avatar_url} name={user.username} size={40} />
        <View style={{ flex: 1 }}>
          <Text variant="label" numberOfLines={1}>
            {user.username}
          </Text>
          {user.level != null || note ? (
            <Text variant="caption" color="textMuted">
              {[user.level != null ? `Level ${user.level}` : null, note]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {children}
    </View>
  );
}
