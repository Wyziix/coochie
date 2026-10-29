import { router } from 'expo-router';

import { Card, Text } from '@/components/ui';
import type { WorkoutSummary } from '@/lib/api/workouts';
import type { SyncMark } from '@/lib/offline/overlay';
import { formatWeight, type WeightUnit } from '@/lib/units';
import { formatDurationShort } from '@/lib/workout/format';

type Props = { workout: WorkoutSummary & SyncMark; unit: WeightUnit; showDate?: boolean };

export function WorkoutRow({ workout: w, unit, showDate = true }: Props) {
  const date = new Date(w.started_at);
  const when = showDate
    ? date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <Card
      onPress={() => router.push({ pathname: '/workouts/[id]', params: { id: w.id } })}
      accessibilityLabel={`${w.name}, ${date.toLocaleDateString()}`}
    >
      <Text variant="label">{w.name}</Text>
      <Text variant="caption" color="textMuted">
        {when} · {formatDurationShort(w.duration_seconds)} · {w.set_count} set
        {w.set_count === 1 ? '' : 's'} · {formatWeight(w.total_volume_kg, unit)}
      </Text>
      {w.sync ? (
        <Text variant="caption" color={w.sync === 'failed' ? 'danger' : 'primary'}>
          {w.sync === 'failed' ? 'Couldn’t sync' : 'Waiting to sync'}
        </Text>
      ) : null}
    </Card>
  );
}
