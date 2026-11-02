import { router } from 'expo-router';

import { NewReportBanner } from '@/components/ai/NewReportBanner';
import { WeeklyOverview } from '@/components/home/WeeklyOverview';
import { NutritionCard } from '@/components/nutrition/NutritionCard';
import { LevelCard } from '@/components/points/LevelCard';
import { InstallCard } from '@/components/settings/InstallCard';
import { StreakCard } from '@/components/social/StreakCard';
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
      <InstallCard dismissible />
      <NewReportBanner />
      <LevelCard />
      <StreakCard />
      <NutritionCard />
      <WeeklyOverview />
      <Button title="Start a workout" onPress={() => router.push('/workout')} fullWidth />
      <Button
        title="Ask the coach"
        variant="secondary"
        onPress={() => router.push('/coach')}
        fullWidth
      />
    </Screen>
  );
}
