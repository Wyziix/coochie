import { Input } from '@/components/ui';
import type { UsernameStatus } from '@/hooks/useUsernameCheck';

type Props = {
  value: string;
  onChange: (value: string) => void;
  status: UsernameStatus;
  error?: string;
};

const hints: Partial<Record<UsernameStatus['state'], string>> = {
  idle: '3–20 characters: letters, numbers and _',
  checking: 'Checking…',
  available: 'Available',
};

export function UsernameField({ value, onChange, status, error }: Props) {
  const statusError = 'message' in status ? status.message : undefined;
  return (
    <Input
      label="Username"
      value={value}
      onChangeText={(text) => onChange(text.toLowerCase())}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="username"
      maxLength={20}
      placeholder="e.g. gleb_lifts"
      error={error ?? statusError}
      hint={hints[status.state]}
    />
  );
}
