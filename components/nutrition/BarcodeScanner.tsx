import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';

/** Android: expo-camera's barcode scanner (EAN-13/8, UPC-A/E). Calls onScan once. */
export function BarcodeScanner({ onScan }: { onScan: (code: string) => void }) {
  const theme = useTheme();
  const [permission, request] = useCameraPermissions();
  const done = useRef(false);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={{ gap: theme.spacing.sm }}>
        <Text color="textMuted">The camera is used only to read barcodes.</Text>
        <Button title="Allow camera" onPress={request} />
      </View>
    );
  }
  return (
    <View style={[styles.box, { borderRadius: theme.radius.lg }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current || !data) return;
          done.current = true;
          onScan(data);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ box: { height: 280, overflow: 'hidden' } });
