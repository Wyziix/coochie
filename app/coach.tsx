import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { FeatureLimit, useFeatureLimit } from '@/components/ai/FeatureLimit';
import { TypingDots } from '@/components/ai/ThinkingIndicator';
import { Button, Card, Chip, ChipRow, EmptyState, ErrorState, Input, Text } from '@/components/ui';
import { useCoachChat } from '@/hooks/useCoach';
import { useTheme } from '@/hooks/useTheme';
import { AiError } from '@/lib/api/ai';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';

const MAX = 1000;
const STARTERS = [
  'How is my training going?',
  'Am I doing enough for legs?',
  'How much protein do I need?',
  'What should I change next week?',
];

/** Chat with the AI coach. Old messages stay readable offline; sending needs a connection. */
export default function CoachScreen() {
  const theme = useTheme();
  const online = useIsOnline();
  const chat = useCoachChat();
  const limit = useFeatureLimit('coach');
  const [text, setText] = useState('');
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const messages = chat.messages.data ?? [];

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [messages.length, chat.pending?.reply]);

  async function send(question = text) {
    const q = question.trim();
    if (!q || chat.pending) return;
    setText('');
    const ok = await chat.send(q);
    if (!ok) setText(q); // keep it so they can try again
  }

  async function clear() {
    const ok = await confirm({
      title: 'Clear the chat?',
      message: 'All messages with the coach are deleted.',
      confirmLabel: 'Clear',
      destructive: true,
    });
    if (ok) chat.clear.mutate();
  }

  const sendError =
    chat.error instanceof AiError
      ? chat.error.message
      : chat.error
        ? describeError(chat.error).message
        : null;
  const canSend = online && !chat.pending && !limit.blocked && text.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length > 0 && online ? (
          <View style={[styles.row, { justifyContent: 'flex-end' }]}>
            <Button
              title="Clear chat"
              variant="ghost"
              onPress={clear}
              disabled={!!chat.pending || chat.clear.isPending}
            />
          </View>
        ) : null}
        {chat.messages.error && !messages.length ? (
          <ErrorState error={chat.messages.error} onRetry={() => chat.messages.refetch()} />
        ) : null}
        {!messages.length && !chat.pending && !chat.messages.isPending ? (
          <EmptyState
            icon="chatbubbles-outline"
            title="Ask your coach"
            message="Questions about your training, recovery or nutrition. Answers use your logged workouts."
          />
        ) : null}
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} text={m.content} />
        ))}
        {chat.pending ? (
          <>
            <Bubble role="user" text={chat.pending.question} />
            {chat.pending.reply ? (
              <Bubble role="assistant" text={chat.pending.reply} />
            ) : (
              <View style={[styles.bubble, styles.left, bubbleColors(theme, 'assistant')]}>
                <TypingDots />
              </View>
            )}
          </>
        ) : null}
        {sendError ? <Text color="danger">{sendError}</Text> : null}
        {chat.clear.error ? (
          <Text color="danger">Couldn’t clear: {describeError(chat.clear.error).message}</Text>
        ) : null}
      </ScrollView>

      {!messages.length && !chat.pending && online ? (
        <ChipRow accessibilityLabel="Suggested questions">
          {STARTERS.map((s) => (
            <Chip key={s} label={s} onPress={() => void send(s)} />
          ))}
        </ChipRow>
      ) : null}

      <View
        style={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xs,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}
      >
        {online ? (
          <>
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <View style={styles.flex}>
                <Input
                  value={text}
                  onChangeText={setText}
                  placeholder="Ask about your training…"
                  accessibilityLabel="Message"
                  multiline
                  maxLength={MAX}
                  editable={!chat.pending}
                  style={{ maxHeight: 120 }}
                />
              </View>
              <Button title="Send" onPress={() => void send()} disabled={!canSend} />
            </View>
            <FeatureLimit feature="coach" />
          </>
        ) : (
          <Card>
            <Text variant="label">Needs connection</Text>
            <Text variant="caption" color="textMuted">
              You can read your old messages. Sending a question works when you’re back online.
            </Text>
          </Card>
        )}
        <Text variant="caption" color="textMuted">
          The coach isn’t a doctor. For pain or injuries, see a doctor or physiotherapist.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

type Theme = ReturnType<typeof useTheme>;
const bubbleColors = (theme: Theme, role: 'user' | 'assistant') =>
  role === 'user'
    ? {
        backgroundColor: theme.colors.primary,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.md,
      }
    : {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.md,
      };

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.bubble,
        role === 'user' ? styles.right : styles.left,
        bubbleColors(theme, role),
      ]}
      accessibilityLabel={`${role === 'user' ? 'You' : 'Coach'}: ${text}`}
    >
      <Text color={role === 'user' ? 'onPrimary' : 'text'} selectable>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  bubble: { maxWidth: '85%' },
  right: { alignSelf: 'flex-end' },
  left: { alignSelf: 'flex-start' },
});
