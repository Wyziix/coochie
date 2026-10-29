import { View } from 'react-native';

import { BottomSheet, Button, Chip, OptionList, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { setTypeLabels, type SetType } from '@/lib/exercises/labels';
import type { ActiveSet } from '@/lib/workout/types';

const RPE_VALUES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const setTypeOptions = (Object.keys(setTypeLabels) as SetType[]).map((value) => ({
  value,
  label: setTypeLabels[value].label,
}));

type Props = {
  set: ActiveSet | null;
  number: number;
  onClose: () => void;
  onChange: (patch: Partial<ActiveSet>) => void;
  onDelete: () => void;
};

export function SetOptionsSheet({ set, number, onClose, onChange, onDelete }: Props) {
  const theme = useTheme();
  return (
    <BottomSheet visible={set !== null} onClose={onClose} title={`Set ${number}`}>
      {set ? (
        <>
          <OptionList
            accessibilityLabel="Set type"
            options={setTypeOptions}
            value={set.type}
            onChange={(type) => onChange({ type })}
          />
          <Text variant="label" color="textMuted">
            RPE (optional) – how hard was it, out of 10
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {RPE_VALUES.map((rpe) => (
              <Chip
                key={rpe}
                label={String(rpe)}
                selected={set.rpe === rpe}
                accessibilityRole="radio"
                onPress={() => onChange({ rpe: set.rpe === rpe ? null : rpe })}
              />
            ))}
          </View>
          <Button title="Delete set" variant="danger" onPress={onDelete} />
          <Button title="Done" variant="secondary" onPress={onClose} />
        </>
      ) : null}
    </BottomSheet>
  );
}
