import { useState } from 'react';
import { View } from 'react-native';

import { BottomSheet, Button, Chip, Input, Text } from '@/components/ui';
import { useReportUser } from '@/hooks/useSocial';
import { useTheme } from '@/hooks/useTheme';
import type { ReportReason } from '@/lib/api/social';
import { describeError } from '@/lib/errors';

const reasons: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'cheating', label: 'Fake workouts' },
  { value: 'inappropriate', label: 'Inappropriate' },
  { value: 'other', label: 'Other' },
];

/** "Report user": a reason and an optional note. Only admins see reports. */
export function ReportSheet({
  visible,
  onClose,
  userId,
  username,
  activityId,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  username: string;
  activityId?: string;
}) {
  const theme = useTheme();
  const report = useReportUser();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');

  function close() {
    setReason(null);
    setNote('');
    report.reset();
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={close} title={`Report ${username}`}>
      {report.isSuccess ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text>Thanks. An admin will look at it.</Text>
          <Button title="Close" onPress={close} fullWidth />
        </View>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {reasons.map((r) => (
              <Chip
                key={r.value}
                label={r.label}
                selected={reason === r.value}
                onPress={() => setReason(r.value)}
              />
            ))}
          </View>
          <Input
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            maxLength={500}
            multiline
          />
          {report.error ? <Text color="danger">{describeError(report.error).message}</Text> : null}
          <Button
            title="Send report"
            onPress={() =>
              reason &&
              report.mutate({ userId, reason, note: note.trim() || undefined, activityId })
            }
            disabled={!reason}
            loading={report.isPending}
            fullWidth
          />
        </View>
      )}
    </BottomSheet>
  );
}
