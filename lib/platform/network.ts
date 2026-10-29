import * as Network from 'expo-network';

/** Calls back with true/false when the connection comes and goes. */
export function subscribeOnline(onChange: (online: boolean) => void): () => void {
  const update = (s: Network.NetworkState) =>
    onChange(s.isConnected !== false && s.isInternetReachable !== false);
  Network.getNetworkStateAsync()
    .then(update)
    .catch(() => {});
  const sub = Network.addNetworkStateListener(update);
  return () => sub.remove();
}
