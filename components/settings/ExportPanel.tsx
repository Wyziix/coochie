import { useState } from 'react';
import { View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { formatSize, prepareExport, type PreparedExport } from '@/lib/account/export';
import { describeError } from '@/lib/errors';
import { useIsOnline } from '@/lib/offline/network';
import { saveFile } from '@/lib/platform/saveFile';

/**
 * Two taps on purpose: the export is built on the server first, then "Save
 * file" opens the share sheet (iPhone) or downloads (Android, desktop). Both
 * need a fresh tap to be allowed.
 */
export function ExportPanel({ photoToken, label }: { photoToken?: string | null; label: string }) {
  const theme = useTheme();
  const online = useIsOnline();
  const [file, setFile] = useState<PreparedExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);

  function prepare() {
    setError(null);
    setNote(null);
    setBusy(true);
    prepareExport(photoToken)
      .then(setFile)
      .catch(setError)
      .finally(() => setBusy(false));
  }

  function save() {
    if (!file) return;
    saveFile(file.blob, file.filename)
      .then((r) => {
        if (r === 'unsupported') setNote('Exports can be saved from the web app.');
        else if (r !== 'cancelled') setNote('Saved. You can export again any time.');
      })
      .catch(setError);
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {file ? (
        <>
          <Text>
            Your export is ready: {file.filename} ({formatSize(file.size)})
          </Text>
          <Button title="Save file" onPress={save} />
        </>
      ) : (
        <Button
          title={online ? label : 'Export needs a connection'}
          variant="secondary"
          loading={busy}
          disabled={!online}
          onPress={prepare}
        />
      )}
      {note ? (
        <Text variant="caption" color="textMuted">
          {note}
        </Text>
      ) : null}
      {error ? <Text color="danger">{describeError(error).message}</Text> : null}
    </View>
  );
}
