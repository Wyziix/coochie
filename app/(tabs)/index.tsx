import { router } from 'expo-router';

import { NewReportBanner } from '@/components/ai/NewReportBanner';
import { WeeklyOverview } from '@/components/home/WeeklyOverview';
import { Button, Header, Screen } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';

export default function HomeScreen() {
  const { data: profile } = useProfile();
  const name = profile?.display_name?.split(' ')[0] || profile?.username;

  return (
    <Screen
      scroll
      header={<Header title={name ? `Hi, ${name}` : 'Home'} subtitle="Your week at a glance" />}
    >
      <NewReportBanner />
      <WeeklyOverview />
      <Button title="Start a workout" onPress={() => router.push('/workout')} fullWidth />
    </Screen>
  );
}
