import { ScrollView } from 'react-native';

import { NotificationsCard } from '@/components/settings/NotificationsCard';
import { SharingCard } from '@/components/settings/SharingCard';
import { NeedsConnectionNote } from '@/components/social/OfflineNote';
import { useTheme } from '@/hooks/useTheme';

/** Who sees my activity, PR weights, and which notifications I get (also in Settings). */
export default function SocialSettingsScreen() {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <NeedsConnectionNote />
      <SharingCard />
      <NotificationsCard />
    </ScrollView>
  );
}
