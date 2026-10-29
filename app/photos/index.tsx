import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BottomSheet,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  LoadingState,
  Text,
} from '@/components/ui';
import { useAddPhoto, useDeletePhoto, usePhotos } from '@/hooks/usePhotos';
import { useTheme } from '@/hooks/useTheme';
import type { Photo, Pose } from '@/lib/api/photos';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { dateKey } from '@/lib/history/calendar';
import { shortDate } from '@/lib/progress/series';

const POSES: { value: Pose; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
  { value: 'other', label: 'Other' },
];

export default function PhotosScreen() {
  const theme = useTheme();
  const { data: photos, isPending, error, refetch } = usePhotos();
  const add = useAddPhoto();
  const remove = useDeletePhoto();
  const [adding, setAdding] = useState(false);
  const [pose, setPose] = useState<Pose>('front');
  const [takenOn, setTakenOn] = useState(dateKey(new Date()));
  const [comparing, setComparing] = useState<string[] | null>(null);
  const [viewing, setViewing] = useState<Photo | null>(null);

  const groups = useMemo(() => {
    const out: { date: string; photos: Photo[] }[] = [];
    for (const p of photos ?? []) {
      const g = out.at(-1);
      if (g && g.date === p.taken_on) g.photos.push(p);
      else out.push({ date: p.taken_on, photos: [p] });
    }
    return out;
  }, [photos]);

  function pick(source: 'camera' | 'library') {
    add.mutate({ source, takenOn, pose }, { onSuccess: (added) => added && setAdding(false) });
  }

  function onTap(p: Photo) {
    if (!comparing) return setViewing(p);
    const next = comparing.includes(p.id)
      ? comparing.filter((id) => id !== p.id)
      : [...comparing, p.id].slice(-2);
    if (next.length === 2) {
      setComparing(null);
      router.push({ pathname: '/photos/compare', params: { a: next[0], b: next[1] } });
    } else setComparing(next);
  }

  async function onDelete(p: Photo) {
    const ok = await confirm({
      title: 'Delete this photo?',
      message: 'It’s removed for good.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(p, { onSuccess: () => setViewing(null) });
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen
        options={{
          title: 'Progress photos',
          headerRight: () =>
            (photos?.length ?? 0) >= 2 ? (
              <Button
                title={comparing ? 'Cancel' : 'Compare'}
                variant="ghost"
                onPress={() => setComparing(comparing ? null : [])}
              />
            ) : null,
        }}
      />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
        <Text variant="caption" color="textMuted">
          Private: only you can see these.
        </Text>
        {comparing ? (
          <Text variant="label" color="primary" accessibilityLiveRegion="polite">
            Tap two photos to compare ({comparing.length}/2)
          </Text>
        ) : (
          <Button title="Add photo" onPress={() => setAdding(true)} fullWidth />
        )}

        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon="camera-outline"
            title="No photos yet"
            message="Same spot, same light, every few weeks. Changes show up better than in the mirror."
          />
        ) : (
          groups.map((g) => (
            <View key={g.date} style={{ gap: theme.spacing.sm }}>
              <Text variant="label" color="textMuted">
                {shortDate(g.date)} {g.date.slice(0, 4)}
              </Text>
              <View style={[styles.grid, { gap: theme.spacing.sm }]}>
                {g.photos.map((p) => {
                  const selected = comparing?.includes(p.id) ?? false;
                  return (
                    <Pressable
                      key={p.id}
                      accessibilityRole={comparing ? 'checkbox' : 'button'}
                      aria-checked={comparing ? selected : undefined}
                      accessibilityLabel={`${p.pose} photo, ${p.taken_on}`}
                      onPress={() => onTap(p)}
                      style={[
                        styles.thumb,
                        {
                          borderRadius: theme.radius.md,
                          borderColor: selected ? theme.colors.primary : 'transparent',
                          backgroundColor: theme.colors.surfaceAlt,
                        },
                      ]}
                    >
                      {p.url ? (
                        <Image
                          source={{ uri: p.url }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                        />
                      ) : null}
                      <Text
                        variant="caption"
                        color="onMedia"
                        style={[styles.pose, { backgroundColor: theme.colors.overlay }]}
                      >
                        {p.pose}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <BottomSheet visible={adding} onClose={() => setAdding(false)} title="Add a progress photo">
        <ChipRow accessibilityLabel="Pose">
          {POSES.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={pose === o.value}
              accessibilityRole="radio"
              onPress={() => setPose(o.value)}
            />
          ))}
        </ChipRow>
        <Input
          label="Date"
          value={takenOn}
          onChangeText={setTakenOn}
          placeholder="2026-10-31"
          maxLength={10}
        />
        {Platform.OS === 'web' ? (
          <>
            <Button
              title="Choose or take a photo"
              onPress={() => pick('library')}
              loading={add.isPending}
              fullWidth
            />
            <Text variant="caption" color="textMuted">
              On iPhone this lets you take a photo or pick one from your library. Photos are shrunk
              before upload.
            </Text>
          </>
        ) : (
          <>
            <Button
              title="Take photo"
              onPress={() => pick('camera')}
              loading={add.isPending}
              fullWidth
            />
            <Button
              title="Choose from library"
              variant="secondary"
              onPress={() => pick('library')}
              disabled={add.isPending}
              fullWidth
            />
          </>
        )}
        {add.error ? (
          <Text color="danger">Couldn’t add the photo: {describeError(add.error).message}</Text>
        ) : null}
      </BottomSheet>

      <Modal
        visible={viewing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
        <SafeAreaView style={[styles.viewer, { backgroundColor: theme.colors.media }]}>
          <View style={styles.viewerBar}>
            <Text color="onMedia" style={styles.flex}>
              {viewing
                ? `${viewing.pose} · ${shortDate(viewing.taken_on)} ${viewing.taken_on.slice(0, 4)}`
                : ''}
            </Text>
            <IconButton
              icon="trash-outline"
              color="danger"
              accessibilityLabel="Delete photo"
              onPress={() => viewing && onDelete(viewing)}
            />
            <IconButton
              icon="close"
              color="onDanger"
              accessibilityLabel="Close"
              onPress={() => setViewing(null)}
            />
          </View>
          {viewing?.url ? (
            <Image source={{ uri: viewing.url }} style={styles.flex} contentFit="contain" />
          ) : null}
          {remove.error ? (
            <Text color="danger">Couldn’t delete: {describeError(remove.error).message}</Text>
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  thumb: {
    width: '31.5%',
    aspectRatio: 3 / 4,
    overflow: 'hidden',
    borderWidth: 3,
    justifyContent: 'flex-end',
  },
  pose: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    margin: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  viewer: { flex: 1 },
  viewerBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
});
