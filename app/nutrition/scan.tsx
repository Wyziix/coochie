import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { BarcodeScanner } from '@/components/nutrition/BarcodeScanner';
import { NeedsConnection } from '@/components/offline/NeedsConnection';
import { Button, Input, LoadingState, Text } from '@/components/ui';
import { useBarcodeLookup } from '@/hooks/useNutrition';
import { useTheme } from '@/hooks/useTheme';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { useNutritionStore } from '@/stores/nutritionStore';

/** Scan (or type) a barcode, look it up, then pick the portion; not found → create it. */
export default function ScanScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const lookup = useBarcodeLookup();
  const [code, setCode] = useState('');
  const [missing, setMissing] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const find = useCallback(
    (raw: string) => {
      const barcode = raw.replace(/\D/g, '');
      setCode(barcode);
      setMissing(null);
      lookup.mutate(barcode, {
        onSuccess: (r) => {
          if (r.found) {
            useNutritionStore.getState().pick(r.food);
            router.replace('/nutrition/food');
          } else setMissing(barcode);
        },
      });
    },
    [lookup],
  );

  if (!online)
    return (
      <NeedsConnection message="Looking up a barcode needs a connection. Quick add works offline." />
    );

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      {!lookup.isPending && !missing ? <BarcodeScanner key={key} onScan={find} /> : null}
      {lookup.isPending ? <LoadingState /> : null}
      {missing ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Not found</Text>
          <Text color="textMuted">
            Barcode {missing} isn’t in Open Food Facts. Add it yourself; it’s saved only for you.
          </Text>
          <Button
            title="Create this food"
            onPress={() =>
              router.replace({ pathname: '/nutrition/new-food', params: { barcode: missing } })
            }
          />
          <Button
            title="Scan again"
            variant="ghost"
            onPress={() => (setMissing(null), setKey((k) => k + 1))}
          />
        </View>
      ) : null}
      {lookup.error ? <Text color="danger">{describeError(lookup.error).message}</Text> : null}
      <View style={{ gap: theme.spacing.sm }}>
        <Input
          label="Or type the barcode"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          placeholder="e.g. 3017620422003"
          maxLength={14}
        />
        <Button
          title="Look up"
          variant="secondary"
          onPress={() => find(code)}
          disabled={code.replace(/\D/g, '').length < 6 || lookup.isPending}
        />
      </View>
      <Text variant="caption" color="textMuted">
        Food data from Open Food Facts (openfoodfacts.org), free and open.
      </Text>
    </ScrollView>
  );
}
