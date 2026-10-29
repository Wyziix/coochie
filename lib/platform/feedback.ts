import * as Haptics from 'expo-haptics';

/** Light tap, e.g. when a set is marked done. */
export function tapFeedback() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Rest timer finished while the app is open. */
export function restDoneAlert() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Web only: unlock audio during a user gesture. No-op on native. */
export function primeAlertSound() {}
