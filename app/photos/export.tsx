import { ScrollView } from 'react-native';

import { PhotoGate } from '@/components/photos/PhotoGate';
import { ExportPanel } from '@/components/settings/ExportPanel';
import { Card, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { usePhotoLockStore } from '@/stores/photoLockStore';

/** Export including progress photos: only behind the photo lock (PIN). */
export default function ExportWithPhotosScreen() {
  return (
    <PhotoGate>
      <ExportWithPhotos />
    </PhotoGate>
  );
}

function ExportWithPhotos() {
  const theme = useTheme();
  const token = usePhotoLockStore((s) => s.token);
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Card>
        <Text variant="heading">Export with photos</Text>
        <Text variant="caption" color="textMuted">
          Your photos are unlocked for a few minutes. The export has everything plus your progress
          photos in a photos folder, so it can be big. Keep the file somewhere private.
        </Text>
        <ExportPanel photoToken={token} label="Export my data with photos" />
      </Card>
    </ScrollView>
  );
}
