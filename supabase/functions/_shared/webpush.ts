// Web push (RFC 8291 encryption + VAPID). The keys come from the function
// secrets (see send-push/index.ts):
//   VAPID_KEYS     JSON from scripts/generate-vapid-keys.mjs ({ publicKey, privateKey } as JWK)
//   VAPID_SUBJECT  mailto: or https: contact for the push services
// The app only gets the public key (EXPO_PUBLIC_VAPID_PUBLIC_KEY).
import * as webpush from 'jsr:@negrel/webpush@0.3.0';

import type { Deps, Delivery } from '../send-push/handler.ts';

export function importKeys(json: string): Promise<CryptoKeyPair> {
  return webpush.importVapidKeys(JSON.parse(json), { extractable: false });
}

export function webPushSender(
  keys: () => Promise<CryptoKeyPair>,
  subject: string,
): Deps['deliver'] {
  return async (subscription, payload, options): Promise<Delivery> => {
    // A fresh ECDH key per message (RFC 8291); the VAPID key stays the same.
    const app = await webpush.ApplicationServer.new({
      contactInformation: subject,
      vapidKeys: await keys(),
    });
    const subscriber = app.subscribe({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    });
    try {
      await subscriber.pushTextMessage(payload, {
        ttl: options.ttl,
        urgency: options.urgency === 'high' ? webpush.Urgency.High : webpush.Urgency.Normal,
      });
      return 'ok';
    } catch (error) {
      // 404/410: the browser unsubscribed or the app was removed.
      if (error instanceof webpush.PushMessageError) {
        return error.isGone() || error.response.status === 404 ? 'gone' : 'error';
      }
      return 'error';
    }
  };
}
