import { useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, Input, OptionList, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { Exercise, ExerciseInput } from '@/lib/api/exercises';
import {
  equipmentOptions,
  muscleOptions,
  typeOptions,
  type Equipment,
  type ExerciseType,
  type MuscleGroup,
} from '@/lib/exercises/labels';
import { formatRest, REST_OPTIONS } from '@/lib/workout/format';

type Props = {
  initial?: Exercise;
  submitLabel: string;
  saving?: boolean;
  error?: string | null;
  onSubmit: (input: ExerciseInput) => void;
};

export function ExerciseForm({ initial, submitLabel, saving, error, onSubmit }: Props) {
  const theme = useTheme();
  const [name, setName] = useState(initial?.name ?? '');
  const [primary, setPrimary] = useState<MuscleGroup | null>(initial?.primary_muscle ?? null);
  const [secondary, setSecondary] = useState<MuscleGroup[]>(initial?.secondary_muscles ?? []);
  const [equipment, setEquipment] = useState<Equipment | null>(initial?.equipment ?? null);
  const [type, setType] = useState<ExerciseType>(initial?.type ?? 'weights');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [rest, setRest] = useState(initial?.default_rest_seconds ?? 90);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit() {
    const found: Record<string, string> = {};
    if (name.trim().length < 2) found.name = 'At least 2 characters';
    if (name.trim().length > 60) found.name = 'At most 60 characters';
    if (!primary) found.primary = 'Pick the main muscle';
    if (!equipment) found.equipment = 'Pick the equipment';
    setErrors(found);
    if (Object.keys(found).length > 0 || !primary || !equipment) return;
    onSubmit({
      name: name.trim(),
      primary_muscle: primary,
      secondary_muscles: secondary.filter((m) => m !== primary),
      equipment,
      type,
      instructions: instructions.trim() || null,
      default_rest_seconds: rest,
    });
  }

  const chipRow = { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm } as const;
  const section = { gap: theme.spacing.sm } as const;

  return (
    <View style={{ gap: theme.spacing.xl }}>
      <Input label="Name" value={name} onChangeText={setName} maxLength={60} error={errors.name} />

      <View style={section}>
        <Text variant="label" color="textMuted">
          Main muscle
        </Text>
        <View style={chipRow} accessibilityLabel="Main muscle">
          {muscleOptions.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={primary === o.value}
              accessibilityRole="radio"
              onPress={() => setPrimary(o.value)}
            />
          ))}
        </View>
        {errors.primary ? (
          <Text variant="caption" color="danger">
            {errors.primary}
          </Text>
        ) : null}
      </View>

      <View style={section}>
        <Text variant="label" color="textMuted">
          Other muscles worked (optional)
        </Text>
        <View style={chipRow} accessibilityLabel="Other muscles">
          {muscleOptions
            .filter((o) => o.value !== primary)
            .map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={secondary.includes(o.value)}
                accessibilityRole="checkbox"
                onPress={() =>
                  setSecondary((s) =>
                    s.includes(o.value) ? s.filter((m) => m !== o.value) : [...s, o.value],
                  )
                }
              />
            ))}
        </View>
      </View>

      <View style={section}>
        <Text variant="label" color="textMuted">
          Equipment
        </Text>
        <View style={chipRow} accessibilityLabel="Equipment">
          {equipmentOptions.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={equipment === o.value}
              accessibilityRole="radio"
              onPress={() => setEquipment(o.value)}
            />
          ))}
        </View>
        {errors.equipment ? (
          <Text variant="caption" color="danger">
            {errors.equipment}
          </Text>
        ) : null}
      </View>

      <View style={section}>
        <Text variant="label" color="textMuted">
          What you log
        </Text>
        <OptionList
          accessibilityLabel="Exercise type"
          options={typeOptions}
          value={type}
          onChange={setType}
        />
      </View>

      <View style={section}>
        <Text variant="label" color="textMuted">
          Default rest
        </Text>
        <View style={chipRow} accessibilityLabel="Default rest">
          {REST_OPTIONS.map((s) => (
            <Chip
              key={s}
              label={formatRest(s)}
              selected={rest === s}
              accessibilityRole="radio"
              onPress={() => setRest(s)}
            />
          ))}
        </View>
      </View>

      <Input
        label="How to do it (optional)"
        value={instructions}
        onChangeText={setInstructions}
        multiline
        maxLength={1000}
        style={{ minHeight: 100, textAlignVertical: 'top', paddingTop: theme.spacing.md }}
      />

      {error ? <Text color="danger">{error}</Text> : null}
      <Button title={submitLabel} onPress={submit} loading={saving} fullWidth />
    </View>
  );
}
