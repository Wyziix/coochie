import { View } from 'react-native';

import { Input, SegmentedControl } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { LockKind } from '@/lib/api/photoLock';

const KIND_OPTIONS: { value: LockKind; label: string }[] = [
  { value: 'pin', label: 'PIN' },
  { value: 'password', label: 'Password' },
];

/** A PIN (4–6 digits) or password field. Browsers are asked not to save it. */
export function SecretInput({
  kind,
  label,
  value,
  onChangeText,
  error,
  onSubmitEditing,
  autoFocus,
}: {
  kind: LockKind;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string;
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
}) {
  const pin = kind === 'pin';
  return (
    <Input
      label={label}
      value={value}
      onChangeText={(v) => onChangeText(pin ? v.replace(/\D/g, '') : v)}
      secureTextEntry
      keyboardType={pin ? 'number-pad' : 'default'}
      inputMode={pin ? 'numeric' : 'text'}
      maxLength={pin ? 6 : 72}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      error={error}
      onSubmitEditing={onSubmitEditing}
      autoFocus={autoFocus}
    />
  );
}

/** Choose PIN or password, then type it twice. */
export function NewSecretFields({
  kind,
  onKindChange,
  secret,
  onSecretChange,
  repeat,
  onRepeatChange,
  error,
  onSubmit,
}: {
  kind: LockKind;
  onKindChange: (k: LockKind) => void;
  secret: string;
  onSecretChange: (v: string) => void;
  repeat: string;
  onRepeatChange: (v: string) => void;
  error?: string;
  onSubmit?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md }}>
      <SegmentedControl
        options={KIND_OPTIONS}
        value={kind}
        onChange={(k) => {
          onKindChange(k);
          onSecretChange('');
          onRepeatChange('');
        }}
      />
      <SecretInput
        kind={kind}
        label={kind === 'pin' ? 'New PIN (4–6 digits)' : 'New password (at least 6 characters)'}
        value={secret}
        onChangeText={onSecretChange}
      />
      <SecretInput
        kind={kind}
        label={kind === 'pin' ? 'Repeat PIN' : 'Repeat password'}
        value={repeat}
        onChangeText={onRepeatChange}
        error={error}
        onSubmitEditing={onSubmit}
      />
    </View>
  );
}
