// Mirrors supabase/migrations. Hand-written for now in the same shape the
// Supabase CLI generates; replace with:
//   npx supabase gen types typescript --linked > types/database.ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string | null;
          display_name: string | null;
          avatar_url: string | null;
          units: Database['public']['Enums']['weight_unit'];
          goal: Database['public']['Enums']['training_goal'] | null;
          experience_level: Database['public']['Enums']['experience_level'] | null;
          training_days_per_week: number | null;
          bodyweight_kg: number | null;
          height_cm: number | null;
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          units?: Database['public']['Enums']['weight_unit'];
          goal?: Database['public']['Enums']['training_goal'] | null;
          experience_level?: Database['public']['Enums']['experience_level'] | null;
          training_days_per_week?: number | null;
          bodyweight_kg?: number | null;
          height_cm?: number | null;
          onboarding_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          units?: Database['public']['Enums']['weight_unit'];
          goal?: Database['public']['Enums']['training_goal'] | null;
          experience_level?: Database['public']['Enums']['experience_level'] | null;
          training_days_per_week?: number | null;
          bodyweight_kg?: number | null;
          height_cm?: number | null;
          onboarding_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_username_available: {
        Args: { name: string };
        Returns: boolean;
      };
    };
    Enums: {
      weight_unit: 'kg' | 'lbs';
      training_goal: 'strength' | 'hypertrophy' | 'fat_loss' | 'general_fitness';
      experience_level: 'beginner' | 'intermediate' | 'advanced';
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
