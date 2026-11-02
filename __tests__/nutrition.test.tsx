import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'path';

import { addDays, localDay, portion } from '@/lib/nutrition/calc';
import { suggestTargets } from '@/lib/nutrition/targets';
import {
  fakeSession,
  nutritionMock,
  nutritionState,
  onboardedProfile,
  resetBackend,
  resetProgress,
  sampleFoods,
} from '@/test-utils/backend';

jest.mock('@/lib/env', () => require('@/test-utils/backend').envMock);
jest.mock('@/lib/supabase', () => require('@/test-utils/backend').supabaseMock);
jest.mock('@/lib/api/profiles', () => require('@/test-utils/backend').profilesMock);
jest.mock('@/lib/api/exercises', () => require('@/test-utils/backend').exercisesMock);
jest.mock('@/lib/api/workouts', () => require('@/test-utils/backend').workoutsMock);
jest.mock('@/lib/api/templates', () => require('@/test-utils/backend').templatesMock);
jest.mock('@/lib/api/progress', () => require('@/test-utils/backend').progressMock);
jest.mock('@/lib/api/body', () => require('@/test-utils/backend').bodyMock);
jest.mock('@/lib/api/photos', () => require('@/test-utils/backend').photosMock);
jest.mock('@/lib/api/ai', () => require('@/test-utils/backend').aiMock);
jest.mock('@/lib/api/photoLock', () => ({
  ...jest.requireActual('@/lib/api/photoLock'),
  ...require('@/test-utils/backend').photoLockMock,
}));
jest.mock('@/lib/photos/biometrics', () => require('@/test-utils/backend').biometricsMock);

const appDir = path.resolve(__dirname, '../app');
const today = localDay();

function start(role: 'user' | 'admin' = 'user') {
  resetProgress();
  resetBackend({ session: fakeSession(), profile: onboardedProfile({ role, height_cm: 180 }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    ((args[2] as { onPress?: () => void }[] | undefined) ?? []).at(-1)?.onPress?.();
  });
});

afterEach(() => act(() => onlineManager.setOnline(true)));

describe('maths', () => {
  it('portion per grams and per serving (same rule as the server)', () => {
    expect(portion(sampleFoods.nutella, { grams: 30 })).toEqual({
      grams: 30,
      kcal: 161.7,
      protein: 1.9,
      carbs: 17.3,
      fat: 9.3,
    });
    expect(portion(sampleFoods.nutella, { servings: 2 })?.kcal).toBe(161.7);
    expect(portion(sampleFoods.yogurt, { servings: 1 })).toBeNull(); // no serving size
  });

  it('Mifflin-St Jeor targets', () => {
    const s = suggestTargets({
      sex: 'male',
      age: 25,
      weightKg: 80,
      heightCm: 180,
      activity: 'moderate',
      goal: 'hypertrophy',
    });
    // BMR = 800 + 1125 − 125 + 5 = 1805; × 1.55 = 2798; +10% = 3078 → 3080.
    expect(s.bmr).toBe(1805);
    expect(s.tdee).toBe(2798);
    expect(s.kcal).toBe(3080);
    expect(s.protein_g).toBe(160);
    expect(s.fat_g).toBe(86);
    expect(s.carbs_g).toBe(417); // (3080 − 160×4 − 86×9) / 4
    expect(s.steps[0]).toBe(
      'BMR (Mifflin-St Jeor) = 10 × 80 kg + 6.25 × 180 cm − 5 × 25 + 5 = 1805 kcal',
    );
    const f = suggestTargets({
      sex: 'female',
      age: 25,
      weightKg: 58,
      heightCm: 165,
      activity: 'light',
      goal: 'fat_loss',
    });
    expect(f.bmr).toBe(1325); // 580 + 1031.25 − 125 − 161
  });
});

describe('logging food', () => {
  it('day view: rings against targets, water buttons', async () => {
    start();
    nutritionState.logs = [
      {
        id: 'l1',
        day: today,
        meal: 'breakfast',
        food_id: 'food-nutella',
        name: 'Nutella',
        grams: 30,
        servings: null,
        kcal: 161.7,
        protein: 1.9,
        carbs: 17.3,
        fat: 9.3,
      },
    ];
    await renderRouter(appDir, { initialUrl: '/nutrition' });
    expect(await screen.findByLabelText('Calories: 162 of 2400 kcal')).toBeOnTheScreen();
    expect(screen.getByLabelText('Protein: 2 of 160 g')).toBeOnTheScreen();
    expect(screen.getByText('2238 kcal left')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '+250 ml' }));
    await waitFor(() =>
      expect(nutritionMock.saveWaterLog).toHaveBeenCalledWith(
        expect.objectContaining({ day: today, ml: 250 }),
        expect.any(String),
      ),
    );
    expect(await screen.findByText('0.25 / 2.5 L')).toBeOnTheScreen();
  });

  it('search, pick a portion in servings, add to a meal (values computed like the server)', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/nutrition' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to lunch' }));
    await fireEvent.changeText(await screen.findByLabelText('Search foods'), 'nut');
    await fireEvent.press(await screen.findByLabelText('Nutella, Ferrero, 539 kcal per 100 g'));
    await fireEvent.changeText(await screen.findByLabelText('Servings (15 g)'), '2');
    expect(await screen.findByText('162 kcal')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Add to log' }));
    await waitFor(() =>
      expect(nutritionMock.saveFoodLog).toHaveBeenCalledWith(
        expect.objectContaining({
          day: today,
          meal: 'lunch',
          food_id: 'food-nutella',
          servings: 2,
          grams: 30,
          kcal: 161.7,
        }),
        expect.any(String),
      ),
    );
    await waitFor(() => expect(screen).toHavePathname('/nutrition'));
  });

  it('quick add: calories plus optional macros', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/nutrition' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to snacks' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Quick add' }));
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '210');
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '20');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(nutritionMock.saveFoodLog).toHaveBeenCalledWith(
        expect.objectContaining({
          meal: 'snack',
          food_id: null,
          name: 'Quick add',
          kcal: 210,
          protein: 20,
          carbs: 0,
        }),
        expect.any(String),
      ),
    );
  });

  it('copy yesterday’s meal', async () => {
    start();
    nutritionState.logs = [
      {
        id: 'y1',
        day: addDays(today, -1),
        meal: 'breakfast',
        food_id: null,
        name: 'Oats',
        grams: null,
        servings: null,
        kcal: 350,
        protein: 12,
        carbs: 60,
        fat: 6,
      },
    ];
    await renderRouter(appDir, { initialUrl: '/nutrition' });
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Copy yesterday’s breakfast' }),
    );
    await waitFor(() =>
      expect(nutritionMock.saveFoodLog).toHaveBeenCalledWith(
        expect.objectContaining({ day: today, meal: 'breakfast', name: 'Oats', kcal: 350 }),
        expect.any(String),
      ),
    );
    expect(nutritionMock.saveFoodLog.mock.calls[0]![0].id).not.toBe('y1');
  });

  it('favourites (queued, so they work offline)', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/nutrition' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to dinner' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Favourites' }));
    await fireEvent.press(await screen.findByLabelText(/^Greek yogurt/));
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove from favourites' }));
    await waitFor(() =>
      expect(nutritionMock.setFoodFavorite).toHaveBeenCalledWith('food-yogurt', false),
    );
  });
});

describe('barcodes', () => {
  it('scan with the camera → found → portion screen', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/nutrition/scan' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Fake camera' }));
    await waitFor(() => expect(nutritionMock.lookupBarcode).toHaveBeenCalledWith('3017620422003'));
    await waitFor(() => expect(screen).toHavePathname('/nutrition/food'));
    expect(await screen.findByText('Nutella')).toBeOnTheScreen();
  });

  it('typed barcode not found → create the food (only for me) → log it', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/nutrition/scan' });
    await fireEvent.changeText(
      await screen.findByLabelText('Or type the barcode'),
      '2000000000017',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Not found')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Create this food' }));
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Mum’s lasagne');
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '160');
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '9');
    await fireEvent.changeText(screen.getByLabelText('Serving size (g)'), '350');
    await fireEvent.press(screen.getByRole('button', { name: 'Save food' }));
    await waitFor(() =>
      expect(nutritionMock.saveMyFood).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Mum’s lasagne',
          barcode: '2000000000017',
          kcal_100g: 160,
          protein_100g: 9,
          serving_g: 350,
          serving_label: '350 g',
        }),
      ),
    );
    await waitFor(() => expect(screen).toHavePathname('/nutrition/food'));
  });
});

describe('offline', () => {
  it('quick add waits in the queue and syncs once back online; search says "Needs connection"', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/nutrition' });
    await screen.findByLabelText('Calories: 0 of 2400 kcal');
    // Opened once online (like any earlier visit), so recent foods are on the device.
    await fireEvent.press(screen.getByRole('button', { name: 'Add to snacks' }));
    await screen.findByLabelText('Search foods');
    await act(() => onlineManager.setOnline(false));
    await fireEvent.press(await screen.findByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Searching for new foods needs a connection/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Recent' }));
    expect(await screen.findByLabelText(/^Nutella/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Quick add' }));
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '300');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByLabelText('Calories: 300 of 2400 kcal')).toBeOnTheScreen();
    expect(screen.getByText(/waiting to sync/)).toBeOnTheScreen();
    expect(nutritionMock.saveFoodLog).not.toHaveBeenCalled();
    await act(() => onlineManager.setOnline(true));
    const { syncNow } = require('@/lib/offline/sync');
    await act(() => syncNow());
    await waitFor(() => expect(nutritionMock.saveFoodLog).toHaveBeenCalledTimes(1));
    expect(nutritionState.logs).toHaveLength(1);
  });

  it('barcode lookup offline: "Needs connection"', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/nutrition' });
    await act(() => onlineManager.setOnline(false));
    await act(() => require('expo-router').router.push('/nutrition/scan'));
    expect(await screen.findByText(/Looking up a barcode needs a connection/)).toBeOnTheScreen();
  });
});

describe('targets and week', () => {
  it('suggest with Mifflin-St Jeor (formula shown), then save', async () => {
    start();
    nutritionState.targets = null;
    await renderRouter(appDir, { initialUrl: '/nutrition/targets' });
    await fireEvent.changeText(await screen.findByLabelText('Age'), '25');
    await fireEvent.press(screen.getByRole('button', { name: 'Suggest' }));
    expect(
      await screen.findByText(
        /^BMR \(Mifflin-St Jeor\) = 10 × 80 kg \+ 6.25 × 180 cm − 5 × 25 \+ 5/,
      ),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Calories (kcal)')).toHaveDisplayValue('2940');
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '170');
    await fireEvent.press(screen.getByRole('button', { name: 'Save targets' }));
    await waitFor(() =>
      expect(nutritionMock.saveTargets).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kcal: 2940, protein_g: 170, method: 'manual' }),
      ),
    );
  });

  it('week: averages over the days with food logged', async () => {
    start();
    nutritionState.logs = [
      {
        id: 'a',
        day: today,
        meal: 'lunch',
        food_id: null,
        name: 'A',
        grams: null,
        servings: null,
        kcal: 2000,
        protein: 150,
        carbs: 200,
        fat: 70,
      },
      {
        id: 'b',
        day: addDays(today, -2),
        meal: 'lunch',
        food_id: null,
        name: 'B',
        grams: null,
        servings: null,
        kcal: 2400,
        protein: 110,
        carbs: 250,
        fat: 90,
      },
    ];
    await renderRouter(appDir, { initialUrl: '/nutrition/week' });
    expect(await screen.findByText('Over the 2 days with food logged')).toBeOnTheScreen();
    expect(screen.getByText('2200 / 2400 kcal')).toBeOnTheScreen();
    expect(screen.getByText('130 / 160 g')).toBeOnTheScreen();
  });

  it('Home shows today’s nutrition', async () => {
    start();
    await renderRouter(appDir, { initialUrl: '/' });
    expect(await screen.findByText('0 / 2400 kcal')).toBeOnTheScreen();
  });
});

describe('admin foods', () => {
  it('fix values and hide a wrong cached food', async () => {
    start('admin');
    await renderRouter(appDir, { initialUrl: '/admin/foods' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Fix Nutella' }));
    await fireEvent.changeText(screen.getByLabelText('kcal'), '530');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(nutritionMock.updateFood).toHaveBeenCalledWith(
        'food-nutella',
        expect.objectContaining({ kcal_100g: 530 }),
      ),
    );
    await fireEvent(screen.getByLabelText('Hide Nutella'), 'valueChange', true);
    await waitFor(() =>
      expect(nutritionMock.setFoodHidden).toHaveBeenCalledWith('food-nutella', true),
    );
  });
});
