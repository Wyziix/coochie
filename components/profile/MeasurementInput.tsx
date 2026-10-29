import { Input, type InputProps } from '@/components/ui';

type Props = Omit<InputProps, 'onChange' | 'onChangeText' | 'value'> & {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
};

/** Numeric input with the unit in the label, e.g. "Bodyweight (kg)". */
export function MeasurementInput({ label, unit, value, onChange, ...props }: Props) {
  return (
    <Input
      label={`${label} (${unit})`}
      value={value}
      onChangeText={(text) => onChange(text.replace(/[^0-9.,]/g, ''))}
      keyboardType="decimal-pad"
      inputMode="decimal"
      maxLength={6}
      {...props}
    />
  );
}
