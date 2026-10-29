import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

type Props = Omit<TextInputProps, 'style'> & { done?: boolean; invalid?: boolean };

/** Compact numeric input for a set row. */
export function CellInput({ done, invalid, ...props }: Props) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.colors.textMuted}
      selectTextOnFocus
      style={[
        styles.input,
        theme.typography.label,
        {
          color: theme.colors.text,
          borderRadius: theme.radius.sm,
          backgroundColor: done ? 'transparent' : theme.colors.surfaceAlt,
          borderColor: invalid ? theme.colors.danger : 'transparent',
        },
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    minWidth: 0,
    height: 40,
    textAlign: 'center',
    borderWidth: 1.5,
    paddingHorizontal: 4,
  },
});
