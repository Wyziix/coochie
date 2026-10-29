import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { LineChartCard } from '@/components/charts/LineChartCard';
import { InfoRow } from '@/components/profile/InfoRow';
import { Button, Card, ErrorState, Input, LoadingState, Text } from '@/components/ui';
import {
  useAiOverrides,
  useAiSettings,
  useAiUsage,
  useGenerateReportNow,
  useSetAiOverride,
  useUpdateAiSettings,
} from '@/hooks/useAi';
import { useTheme } from '@/hooks/useTheme';
import { AiError, findUsers, type AiSettings } from '@/lib/api/ai';
import { confirm } from '@/lib/confirm';
import { describeError } from '@/lib/errors';

const usd = (n: number) => `$${Number(n).toFixed(n < 0.1 ? 4 : 2)}`;

/** Admin → AI: kill switch, limits, spending cap, model, overrides, usage. All logged. */
export default function AdminAiScreen() {
  const theme = useTheme();
  const settings = useAiSettings();

  if (settings.isPending) return <LoadingState />;
  if (settings.error)
    return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <KillSwitch settings={settings.data} />
      <SettingsForm settings={settings.data} />
      <Overrides defaultLimit={settings.data.daily_limit} />
      <Usage />
      <GenerateNow />
    </ScrollView>
  );
}

function KillSwitch({ settings }: { settings: AiSettings }) {
  const update = useUpdateAiSettings();
  async function toggle() {
    if (settings.enabled) {
      const ok = await confirm({
        title: 'Turn AI off for everyone?',
        message: 'Feedback and weekly reports stop right away until you turn it back on.',
        confirmLabel: 'Turn off',
        destructive: true,
      });
      if (!ok) return;
    }
    update.mutate({ enabled: !settings.enabled });
  }
  return (
    <Card>
      <Text variant="heading">{settings.enabled ? 'AI is on' : 'AI is off for everyone'}</Text>
      <InfoRow
        label="Spent today"
        value={`${usd(settings.spent_today_usd)} of ${usd(settings.daily_budget_usd)}`}
      />
      <Button
        title={settings.enabled ? 'Turn AI off (kill switch)' : 'Turn AI back on'}
        variant={settings.enabled ? 'danger' : 'primary'}
        onPress={toggle}
        loading={update.isPending}
      />
      {update.error ? <Text color="danger">{describeError(update.error).message}</Text> : null}
    </Card>
  );
}

function SettingsForm({ settings }: { settings: AiSettings }) {
  const theme = useTheme();
  const update = useUpdateAiSettings();
  const [form, setForm] = useState({
    daily_limit: String(settings.daily_limit),
    daily_budget_usd: String(settings.daily_budget_usd),
    model: settings.model,
    max_tokens_feedback: String(settings.max_tokens_feedback),
    max_tokens_weekly: String(settings.max_tokens_weekly),
  });
  const [saved, setSaved] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  };

  function save() {
    const changes: Partial<AiSettings> = {};
    const num = (v: string) => Number(v.replace(',', '.'));
    if (num(form.daily_limit) !== settings.daily_limit) changes.daily_limit = num(form.daily_limit);
    if (num(form.daily_budget_usd) !== Number(settings.daily_budget_usd))
      changes.daily_budget_usd = num(form.daily_budget_usd);
    if (form.model.trim() !== settings.model) changes.model = form.model.trim();
    if (num(form.max_tokens_feedback) !== settings.max_tokens_feedback)
      changes.max_tokens_feedback = num(form.max_tokens_feedback);
    if (num(form.max_tokens_weekly) !== settings.max_tokens_weekly)
      changes.max_tokens_weekly = num(form.max_tokens_weekly);
    if (Object.keys(changes).length === 0) return setSaved(true);
    update.mutate(changes, { onSuccess: () => setSaved(true) });
  }

  return (
    <Card>
      <Text variant="heading">Settings</Text>
      <View style={{ gap: theme.spacing.md }}>
        <Input
          label="AI requests per user per day"
          value={form.daily_limit}
          onChangeText={set('daily_limit')}
          keyboardType="number-pad"
        />
        <Input
          label="Daily spending cap (USD, everyone together)"
          value={form.daily_budget_usd}
          onChangeText={set('daily_budget_usd')}
          keyboardType="decimal-pad"
        />
        <Input
          label="Model ID"
          value={form.model}
          onChangeText={set('model')}
          autoCapitalize="none"
          autoCorrect={false}
          hint="Used by every AI feature. Update the prices below the dashboard if you change it."
        />
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <View style={styles.flex}>
            <Input
              label="Max tokens: feedback"
              value={form.max_tokens_feedback}
              onChangeText={set('max_tokens_feedback')}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.flex}>
            <Input
              label="Max tokens: weekly"
              value={form.max_tokens_weekly}
              onChangeText={set('max_tokens_weekly')}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <Text variant="caption" color="textMuted">
          Prices (USD per million tokens): input {settings.price_input}, output{' '}
          {settings.price_output}, cache write {settings.price_cache_write}, cache read{' '}
          {settings.price_cache_read}. Days count in {settings.timezone}.
        </Text>
        <Button title="Save" onPress={save} loading={update.isPending} />
        {update.error ? <Text color="danger">{describeError(update.error).message}</Text> : null}
        {saved && !update.error ? <Text color="success">Saved.</Text> : null}
      </View>
    </Card>
  );
}

function Overrides({ defaultLimit }: { defaultLimit: number }) {
  const theme = useTheme();
  const overrides = useAiOverrides();
  const setOverride = useSetAiOverride();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState('10');
  const [results, setResults] = useState<Awaited<ReturnType<typeof findUsers>>>([]);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setError(null);
    try {
      setResults(await findUsers(query));
    } catch (e) {
      setError(describeError(e).message);
    }
  }

  return (
    <Card>
      <Text variant="heading">Per-user limits</Text>
      <Text variant="caption" color="textMuted">
        Everyone else gets {defaultLimit} a day.
      </Text>
      {overrides.data?.length ? (
        overrides.data.map((o) => (
          <View key={o.user_id} style={[styles.row, { gap: theme.spacing.sm }]}>
            <Text style={styles.flex}>
              {o.display_name || o.username || o.user_id}: {o.daily_limit} a day
            </Text>
            <Button
              title="Remove"
              variant="ghost"
              onPress={() => setOverride.mutate({ userId: o.user_id, limit: null })}
            />
          </View>
        ))
      ) : (
        <Text color="textMuted">No overrides.</Text>
      )}
      <View style={{ gap: theme.spacing.sm }}>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <View style={styles.flex}>
            <Input
              label="Find a user (name or email)"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              onSubmitEditing={search}
            />
          </View>
          <View style={styles.small}>
            <Input
              label="Per day"
              value={limit}
              onChangeText={setLimit}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <Button
          title="Search"
          variant="secondary"
          onPress={search}
          disabled={query.trim().length < 2}
        />
        {results.map((u) => (
          <View key={u.user_id} style={[styles.row, { gap: theme.spacing.sm }]}>
            <Text style={styles.flex}>
              {u.display_name || u.username} · {u.email}
            </Text>
            <Button
              title={`Set ${limit}`}
              variant="secondary"
              onPress={() => setOverride.mutate({ userId: u.user_id, limit: Number(limit) })}
            />
          </View>
        ))}
        {error || setOverride.error ? (
          <Text color="danger">{error ?? describeError(setOverride.error).message}</Text>
        ) : null}
      </View>
    </Card>
  );
}

function Usage() {
  const theme = useTheme();
  const usage = useAiUsage(30);
  if (usage.isPending) return <LoadingState />;
  if (usage.error) return <ErrorState error={usage.error} onRetry={() => usage.refetch()} />;
  const { totals, days, top_users } = usage.data;
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="heading">Last 30 days</Text>
      <Card>
        <InfoRow label="Calls" value={String(totals.calls)} />
        <InfoRow label="Cost" value={usd(totals.cost_usd)} />
        <InfoRow
          label="Errors"
          value={`${totals.errors} (${Math.round(totals.error_rate * 100)}%)`}
        />
        <InfoRow label="Blocked (limit, cap, off)" value={String(totals.blocked)} />
        <InfoRow
          label="Tokens in / out"
          value={`${totals.input_tokens.toLocaleString()} / ${totals.output_tokens.toLocaleString()}`}
        />
      </Card>
      <LineChartCard
        title="Calls per day"
        points={days.map((d) => ({ date: d.day, value: d.calls }))}
        format={(v) => `${Math.round(v)} calls`}
        formatAxis={(v) => String(Math.round(v))}
      />
      <LineChartCard
        title="Cost per day"
        points={days.map((d) => ({ date: d.day, value: Number(d.cost_usd) }))}
        format={usd}
        formatAxis={(v) => `$${v.toFixed(2)}`}
      />
      <Card>
        <Text variant="label">Top users</Text>
        {top_users.length ? (
          top_users.map((u) => (
            <InfoRow
              key={u.user_id}
              label={u.username ?? u.user_id.slice(0, 8)}
              value={`${u.calls} calls · ${usd(u.cost_usd)}`}
            />
          ))
        ) : (
          <Text color="textMuted">No calls yet.</Text>
        )}
      </Card>
    </View>
  );
}

function GenerateNow() {
  const generate = useGenerateReportNow();
  const error =
    generate.error instanceof AiError
      ? generate.error.message
      : generate.error
        ? describeError(generate.error).message
        : null;
  return (
    <Card>
      <Text variant="heading">Test the weekly report</Text>
      <Text variant="caption" color="textMuted">
        Writes your own report for this week now (one real Claude call). The Monday job does the
        same for everyone who trained last week.
      </Text>
      <Button
        title="Generate my report now"
        variant="secondary"
        onPress={() =>
          generate.mutate(undefined, {
            onSuccess: ({ report }) =>
              router.push({ pathname: '/reports/[id]', params: { id: report.id } }),
          })
        }
        loading={generate.isPending}
      />
      {error ? <Text color="danger">{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  small: { width: 90 },
});
