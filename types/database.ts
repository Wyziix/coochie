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
          role: Database['public']['Enums']['app_role'];
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
          role?: Database['public']['Enums']['app_role'];
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
          role?: Database['public']['Enums']['app_role'];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      admin_actions: {
        Row: {
          id: number;
          admin_id: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          details: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      exercises: {
        Row: {
          id: string;
          slug: string | null;
          name: string;
          primary_muscle: Database['public']['Enums']['muscle_group'];
          secondary_muscles: Database['public']['Enums']['muscle_group'][];
          equipment: Database['public']['Enums']['equipment'];
          type: Database['public']['Enums']['exercise_type'];
          instructions: string | null;
          default_rest_seconds: number;
          owner_id: string | null;
          is_hidden: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          primary_muscle: Database['public']['Enums']['muscle_group'];
          secondary_muscles?: Database['public']['Enums']['muscle_group'][];
          equipment: Database['public']['Enums']['equipment'];
          type: Database['public']['Enums']['exercise_type'];
          instructions?: string | null;
          default_rest_seconds?: number;
          owner_id: string;
        };
        Update: {
          name?: string;
          primary_muscle?: Database['public']['Enums']['muscle_group'];
          secondary_muscles?: Database['public']['Enums']['muscle_group'][];
          equipment?: Database['public']['Enums']['equipment'];
          type?: Database['public']['Enums']['exercise_type'];
          instructions?: string | null;
          default_rest_seconds?: number;
        };
        Relationships: [];
      };
      personal_records: {
        Row: {
          id: number;
          user_id: string;
          exercise_id: string;
          record_type: Database['public']['Enums']['record_type'];
          bucket_kg: number;
          value: number;
          weight_kg: number | null;
          reps: number | null;
          workout_id: string;
          set_id: string | null;
          achieved_at: string;
          previous_value: number | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'personal_records_exercise_id_fkey';
            columns: ['exercise_id'];
            isOneToOne: false;
            referencedRelation: 'exercises';
            referencedColumns: ['id'];
          },
        ];
      };
      body_measurements: {
        Row: {
          id: string;
          user_id: string;
          measured_on: string;
          bodyweight_kg: number | null;
          body_fat_pct: number | null;
          neck_cm: number | null;
          shoulders_cm: number | null;
          chest_cm: number | null;
          waist_cm: number | null;
          hips_cm: number | null;
          arm_cm: number | null;
          thigh_cm: number | null;
          calf_cm: number | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          measured_on: string;
          bodyweight_kg?: number | null;
          body_fat_pct?: number | null;
          neck_cm?: number | null;
          shoulders_cm?: number | null;
          chest_cm?: number | null;
          waist_cm?: number | null;
          hips_cm?: number | null;
          arm_cm?: number | null;
          thigh_cm?: number | null;
          calf_cm?: number | null;
          notes?: string | null;
        };
        Update: Partial<Database['public']['Tables']['body_measurements']['Insert']>;
        Relationships: [];
      };
      progress_photos: {
        Row: {
          id: string;
          user_id: string;
          taken_on: string;
          storage_path: string;
          width: number | null;
          height: number | null;
          pose: 'front' | 'side' | 'back' | 'other';
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          taken_on?: string;
          storage_path: string;
          width?: number | null;
          height?: number | null;
          pose?: 'front' | 'side' | 'back' | 'other';
          notes?: string | null;
        };
        Update: {
          taken_on?: string;
          pose?: 'front' | 'side' | 'back' | 'other';
          notes?: string | null;
        };
        Relationships: [];
      };
      ai_feedback: {
        Row: {
          id: string;
          user_id: string;
          kind: 'workout' | 'weekly';
          workout_id: string | null;
          week_start: string | null;
          content: Json;
          model: string;
          source_updated_at: string | null;
          seen_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      ai_usage: {
        Row: {
          id: string;
          user_id: string;
          function: string;
          ref_id: string | null;
          status: string;
          counts_toward_limit: boolean;
          model: string | null;
          input_tokens: number;
          output_tokens: number;
          cache_write_tokens: number;
          cache_read_tokens: number;
          attempts: number;
          cost_usd: number;
          estimated_cost_usd: number;
          error: string | null;
          day: string;
          created_at: string;
          finished_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      templates: {
        Row: {
          id: string;
          owner_id: string | null;
          name: string;
          notes: string | null;
          program: string | null;
          position: number;
          is_hidden: boolean;
          created_at: string;
          updated_at: string;
          /** When the last change was made on the device (last write wins). */
          client_updated_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      template_exercises: {
        Row: {
          id: string;
          template_id: string;
          exercise_id: string;
          position: number;
          target_sets: number;
          target_reps_min: number | null;
          target_reps_max: number | null;
          target_duration_seconds: number | null;
          rest_seconds: number | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'template_exercises_template_id_fkey';
            columns: ['template_id'];
            isOneToOne: false;
            referencedRelation: 'templates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'template_exercises_exercise_id_fkey';
            columns: ['exercise_id'];
            isOneToOne: false;
            referencedRelation: 'exercises';
            referencedColumns: ['id'];
          },
        ];
      };
      user_exercise_settings: {
        Row: {
          user_id: string;
          exercise_id: string;
          rest_seconds: number;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          exercise_id: string;
          rest_seconds: number;
        };
        Update: {
          rest_seconds?: number;
        };
        Relationships: [];
      };
      workouts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          started_at: string;
          ended_at: string;
          duration_seconds: number;
          total_volume_kg: number;
          notes: string | null;
          template_id: string | null;
          created_at: string;
          updated_at: string;
          /** When the last change was made on the device (last write wins). */
          client_updated_at: string | null;
        };
        Insert: never;
        Update: {
          name?: string;
          notes?: string | null;
        };
        Relationships: [];
      };
      workout_sets: {
        Row: {
          id: string;
          workout_id: string;
          user_id: string;
          exercise_id: string;
          exercise_order: number;
          set_order: number;
          set_type: Database['public']['Enums']['set_type'];
          weight_kg: number | null;
          reps: number | null;
          rpe: number | null;
          duration_seconds: number | null;
          distance_m: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'workout_sets_exercise_id_fkey';
            columns: ['exercise_id'];
            isOneToOne: false;
            referencedRelation: 'exercises';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'workout_sets_workout_id_fkey';
            columns: ['workout_id'];
            isOneToOne: false;
            referencedRelation: 'workouts';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_username_available: {
        Args: { name: string };
        Returns: boolean;
      };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      admin_save_exercise: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_primary_muscle: Database['public']['Enums']['muscle_group'];
          p_secondary_muscles: Database['public']['Enums']['muscle_group'][];
          p_equipment: Database['public']['Enums']['equipment'];
          p_type: Database['public']['Enums']['exercise_type'];
          p_instructions: string | null;
          p_default_rest_seconds: number;
        };
        Returns: Database['public']['Tables']['exercises']['Row'];
      };
      admin_set_exercise_hidden: {
        Args: { p_id: string; p_hidden: boolean };
        Returns: Database['public']['Tables']['exercises']['Row'];
      };
      workout_records: {
        Args: { p_workout_id: string };
        Returns: {
          exercise_id: string;
          exercise_name: string;
          exercise_type: Database['public']['Enums']['exercise_type'];
          record_type: Database['public']['Enums']['record_type'];
          value: number;
          previous_value: number;
          weight_kg: number | null;
          reps: number | null;
        }[];
      };
      exercise_history: {
        Args: { p_exercise_id: string; p_since?: string | null };
        Returns: {
          workout_id: string;
          started_at: string;
          max_weight_kg: number | null;
          best_e1rm_kg: number | null;
          volume_kg: number;
          total_reps: number;
          max_duration_seconds: number | null;
          total_distance_m: number | null;
        }[];
      };
      trained_exercises: {
        Args: Record<string, never>;
        Returns: {
          exercise_id: string;
          name: string;
          type: Database['public']['Enums']['exercise_type'];
          primary_muscle: Database['public']['Enums']['muscle_group'];
          sessions: number;
          last_performed: string;
        }[];
      };
      weekly_overview: { Args: { p_from: string; p_to: string }; Returns: Json };
      delete_workout_at: { Args: { p_id: string; p_deleted_at: string }; Returns: undefined };
      delete_template: { Args: { p_id: string; p_deleted_at?: string | null }; Returns: undefined };
      ai_status: { Args: Record<string, never>; Returns: Json };
      ai_mark_seen: { Args: { p_id: string }; Returns: undefined };
      save_push_token: { Args: { p_token: string; p_platform?: string }; Returns: undefined };
      delete_push_token: { Args: { p_token: string }; Returns: undefined };
      admin_ai_settings: { Args: Record<string, never>; Returns: Json };
      admin_update_ai_settings: { Args: { p_changes: Json }; Returns: Json };
      admin_set_ai_override: {
        Args: { p_user: string; p_limit: number | null };
        Returns: undefined;
      };
      admin_ai_overrides: { Args: Record<string, never>; Returns: Json };
      admin_find_users: { Args: { p_query: string }; Returns: Json };
      admin_ai_usage: { Args: { p_days?: number }; Returns: Json };
      photo_lock_status: { Args: Record<string, never>; Returns: Json };
      photo_setup: { Args: { p_kind: string; p_secret: string }; Returns: Json };
      photo_unlock: {
        Args: { p_secret?: string | null; p_device_key?: string | null };
        Returns: Json;
      };
      photo_relock: { Args: { p_token: string }; Returns: undefined };
      photo_change_secret: {
        Args: { p_current: string; p_kind: string; p_secret: string };
        Returns: Json;
      };
      photo_remove_secret: { Args: { p_current: string }; Returns: Json };
      photo_reset_lock: { Args: Record<string, never>; Returns: undefined };
      photo_register_device: { Args: { p_token: string; p_name?: string | null }; Returns: Json };
      photo_forget_device: { Args: { p_id: string }; Returns: undefined };
      save_template: {
        Args: { p_id: string | null; p_template: Json; p_exercises: Json };
        Returns: Database['public']['Tables']['templates']['Row'];
      };
      template_from_workout: {
        Args: { p_workout_id: string; p_name: string };
        Returns: Database['public']['Tables']['templates']['Row'];
      };
      admin_save_template: {
        Args: { p_id: string | null; p_template: Json; p_exercises: Json };
        Returns: Database['public']['Tables']['templates']['Row'];
      };
      admin_set_template_hidden: {
        Args: { p_id: string; p_hidden: boolean };
        Returns: Database['public']['Tables']['templates']['Row'];
      };
      admin_delete_template: { Args: { p_id: string }; Returns: undefined };
      delete_workout: { Args: { p_id: string }; Returns: undefined };
      save_workout: {
        Args: { p_workout: Json; p_sets: Json };
        Returns: Database['public']['Tables']['workouts']['Row'];
      };
      last_exercise_sets: {
        Args: { p_exercise_ids: string[] };
        Returns: {
          exercise_id: string;
          set_index: number;
          set_type: Database['public']['Enums']['set_type'];
          weight_kg: number | null;
          reps: number | null;
          rpe: number | null;
          duration_seconds: number | null;
          distance_m: number | null;
          performed_at: string;
        }[];
      };
    };
    Enums: {
      weight_unit: 'kg' | 'lbs';
      training_goal: 'strength' | 'hypertrophy' | 'fat_loss' | 'general_fitness';
      experience_level: 'beginner' | 'intermediate' | 'advanced';
      app_role: 'user' | 'admin';
      muscle_group:
        | 'chest'
        | 'back'
        | 'lower_back'
        | 'traps'
        | 'shoulders'
        | 'biceps'
        | 'triceps'
        | 'forearms'
        | 'abs'
        | 'obliques'
        | 'quads'
        | 'hamstrings'
        | 'glutes'
        | 'calves'
        | 'adductors'
        | 'full_body'
        | 'cardio';
      equipment:
        | 'barbell'
        | 'dumbbell'
        | 'machine'
        | 'cable'
        | 'bodyweight'
        | 'kettlebell'
        | 'band'
        | 'smith_machine'
        | 'ez_bar'
        | 'cardio_machine'
        | 'other';
      exercise_type: 'weights' | 'bodyweight' | 'cardio' | 'timed';
      set_type: 'warmup' | 'normal' | 'drop' | 'failure';
      record_type:
        'heaviest_weight' | 'best_e1rm' | 'reps_at_weight' | 'session_volume' | 'longest_duration';
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
