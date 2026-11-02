import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Header, Screen, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';

type Section = {
  title: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  href?: Href;
  stage?: number;
};

const sections: Section[] = [
  {
    title: 'Exercise library',
    description: 'Add, edit and hide global exercises',
    icon: 'barbell-outline',
    href: '/admin/exercises',
  },
  {
    title: 'Templates',
    description: 'Ready-made workout templates and programs',
    icon: 'albums-outline',
    href: '/admin/templates',
  },
  {
    title: 'AI',
    description: 'Kill switch, limits, spending cap, usage dashboard',
    icon: 'sparkles-outline',
    href: '/admin/ai',
  },
  {
    title: 'Flagged workouts',
    description: 'Suspicious workouts waiting for review',
    icon: 'shield-outline',
    href: '/admin/flagged',
  },
  {
    title: 'Users',
    description: 'Points, levels, leaderboard bans and hiding',
    icon: 'people-outline',
    href: '/admin/users',
  },
  {
    title: 'Points',
    description: 'Point values, caps, levels and anti-cheat limits',
    icon: 'star-outline',
    href: '/admin/points',
  },
  {
    title: 'Reports',
    description: 'Reported users: dismiss, hide from leaderboards or ban',
    icon: 'flag-outline',
    href: '/admin/reports',
  },
  {
    title: 'Badges',
    description: 'Create, edit and hide badges',
    icon: 'ribbon-outline',
    href: '/admin/badges',
  },
  {
    title: 'Challenges',
    description: 'Global monthly challenges for everyone',
    icon: 'trophy-outline',
    href: '/admin/challenges',
  },
];

export default function AdminHomeScreen() {
  const theme = useTheme();
  return (
    <Screen scroll header={<Header title="Admin" subtitle="Every action here is logged" />}>
      {sections.map((s) => {
        const enabled = !!s.href;
        return (
          <Card
            key={s.title}
            onPress={enabled ? () => router.push(s.href!) : undefined}
            accessibilityLabel={enabled ? s.title : `${s.title}, coming in stage ${s.stage}`}
            style={!enabled && styles.disabled}
          >
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <Ionicons
                name={s.icon}
                size={24}
                color={theme.colors[enabled ? 'primary' : 'textMuted']}
              />
              <View style={styles.flex}>
                <Text variant="label">{s.title}</Text>
                <Text variant="caption" color="textMuted">
                  {enabled ? s.description : `${s.description} · coming in stage ${s.stage}`}
                </Text>
              </View>
              {enabled ? (
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  disabled: { opacity: 0.6 },
});
