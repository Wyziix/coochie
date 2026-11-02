// Open Food Facts: request URLs and turning a product into our food row.
// https://openfoodfacts.github.io/openfoodfacts-server/api/ asks every app
// to send a User-Agent "AppName/Version (contact)".

export const OFF_BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity';

export const productUrl = (barcode: string) =>
  `${OFF_BASE}/api/v2/product/${barcode}?fields=${FIELDS}`;
export const searchUrl = (query: string) =>
  `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}`;

export function userAgent(contact?: string | null) {
  return `LightweightBaby/1.0 (${contact?.trim() || 'https://lightweightbaby.pages.dev'})`;
}

export type OffProduct = {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, number | string | undefined>;
};

export type FoodInput = {
  barcode: string;
  name: string;
  brand: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  serving_g: number | null;
  serving_label: string | null;
};

const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Our food row from an Open Food Facts product, or null if it has no usable calories. */
export function toFood(p: OffProduct): FoodInput | null {
  const n = p.nutriments ?? {};
  const kcal =
    num(n['energy-kcal_100g']) ??
    (num(n['energy_100g']) !== null ? num(n['energy_100g'])! / 4.184 : null);
  const name = (p.product_name || p.product_name_en || '').trim();
  const barcode = String(p.code ?? '').trim();
  if (kcal === null || kcal > 900 || !name || !/^[0-9]{6,14}$/.test(barcode)) return null;
  const serving = num(p.serving_quantity);
  return {
    barcode,
    name: name.slice(0, 120),
    brand: (p.brands ?? '').split(',')[0]?.trim().slice(0, 80) || null,
    kcal_100g: round1(kcal),
    protein_100g: round1(Math.min(num(n.proteins_100g) ?? 0, 100)),
    carbs_100g: round1(Math.min(num(n.carbohydrates_100g) ?? 0, 100)),
    fat_100g: round1(Math.min(num(n.fat_100g) ?? 0, 100)),
    serving_g: serving && serving > 0 && serving <= 2000 ? round1(serving) : null,
    serving_label: p.serving_size?.trim().slice(0, 40) || null,
  };
}
