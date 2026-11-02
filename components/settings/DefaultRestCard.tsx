import { Card, Chip, ChipRow, Text } from '@/components/ui';
import { useProfile, useSaveProfile } from '@/hooks/useProfile';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';

const choices: { value: number | null; label: string }[] = [
  { value: null, label: 'Per exercise' },
  { value: 60, label: '1:00' },
  { value: 90, label: '1:30' },
  { value: 120, label: '2:00' },
  { value: 150, label: '2:30' },
  { value: 180, label: '3:00' },
  { value: 240, label: '4:00' },
  { value: 300, label: '5:00' },
];

/** Rest timer for exercises without their own rest time. */
export function DefaultRestCard() {
  const online = useIsOnline();
  const { data: profile } = useProfile();
  const save = useSaveProfile();
  const current = profile?.default_rest_seconds ?? null;
  return (
    <Card>
      <Text variant="heading">Default rest time</Text>
      <Text variant="caption" color="textMuted">
        Used when you add an exercise to a workout. An exercise’s own rest time (set from the timer)
        still wins. “Per exercise” uses each exercise’s suggested rest.
      </Text>
      <ChipRow accessibilityLabel="Default rest time">
        {choices.map((c) => (
          <Chip
            key={c.label}
            label={c.label}
            accessibilityRole="radio"
            selected={current === c.value}
            onPress={() => {
              if (online && !save.isPending && current !== c.value)
                save.mutate({ default_rest_seconds: c.value });
            }}
          />
        ))}
      </ChipRow>
      {!online ? (
        <Text variant="caption" color="textMuted">
          Needs a connection to change.
        </Text>
      ) : null}
      {save.error ? <Text color="danger">{describeError(save.error).message}</Text> : null}
    </Card>
  );
}
