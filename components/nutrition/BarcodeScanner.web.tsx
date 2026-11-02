import { createElement, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';

/**
 * Web (incl. the iPhone home-screen app, where Safari has no BarcodeDetector):
 * ZXing (@zxing/browser) reads EAN/UPC barcodes from the camera video.
 * Loaded only when the scanner opens. Manual entry is next to it.
 */
export function BarcodeScanner({ onScan }: { onScan: (code: string) => void }) {
  const theme = useTheme();
  const video = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw Object.assign(new Error('no camera'), { name: 'NotSupported' });
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all(
          [import('@zxing/browser'), import('@zxing/library')],
        );
        const hints = new Map([
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E],
          ],
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
        const el = video.current!;
        // iOS needs inline, muted video to show the camera inside the app.
        el.setAttribute('playsinline', 'true');
        el.muted = true;
        let found = false;
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false },
          el,
          (result, _error, ctrl) => {
            if (!result || found) return;
            found = true;
            ctrl.stop();
            onScan(result.getText());
          },
        );
        if (cancelled) controls.stop();
        stop = () => controls.stop();
      } catch (e) {
        const name = (e as Error)?.name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow it in Settings → Safari → Camera (or the site settings), or type the barcode below.'
            : 'No camera available here. Type the barcode below.',
        );
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [onScan]);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {error ? (
        <Text color="textMuted">{error}</Text>
      ) : (
        <View
          style={{
            height: 280,
            borderRadius: theme.radius.lg,
            overflow: 'hidden',
            backgroundColor: theme.colors.media,
          }}
        >
          {createElement('video', {
            ref: video,
            autoPlay: true,
            muted: true,
            playsInline: true,
            'aria-label': 'Camera',
            style: { width: '100%', height: '100%', objectFit: 'cover' },
          })}
        </View>
      )}
    </View>
  );
}
