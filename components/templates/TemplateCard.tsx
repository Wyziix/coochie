import { Pressable, StyleSheet } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { Template } from '@/lib/api/templates';

type Props = {
  template: Template;
  onOpen: () => void;
  onStart?: () => void;
};

/** Summary of a template. Opening it and starting it are two sibling buttons (no nesting). */
export function TemplateCard({ template, onOpen, onStart }: Props) {
  const theme = useTheme();
  const names = template.exercises.map((e) => e.exercise.name);
  const summary = names.slice(0, 3).join(', ') + (names.length > 3 ? `, +${names.length - 3}` : '');

  return (
    <Card style={[styles.row, { gap: theme.spacing.md, padding: theme.spacing.md }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${template.name} details`}
        onPress={onOpen}
        style={({ pressed }) => [styles.body, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text variant="label" color={template.is_hidden ? 'textMuted' : 'text'}>
          {template.name}
          {template.is_hidden ? ' (hidden)' : ''}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={2}>
          {names.length} exercise{names.length === 1 ? '' : 's'} · {summary}
        </Text>
      </Pressable>
      {onStart ? (
        <Button title="Start" accessibilityLabel={`Start ${template.name}`} onPress={onStart} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1, gap: 2, minHeight: 44, justifyContent: 'center' },
});
