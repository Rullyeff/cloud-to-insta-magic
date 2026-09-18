export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ig_accounts: {
        Row: {
          created_at: string
          display_name: string | null
          enabled: boolean
          id: string
          ig_user_id: string
          page_id: string | null
          page_name: string | null
          profile_picture_url: string | null
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          enabled?: boolean
          id?: string
          ig_user_id: string
          page_id?: string | null
          page_name?: string | null
          profile_picture_url?: string | null
          updated_at?: string
          user_id?: string
          username: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          enabled?: boolean
          id?: string
          ig_user_id?: string
          page_id?: string | null
          page_name?: string | null
          profile_picture_url?: string | null
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      posts: {
        Row: {
          account_id: string
          attempts: number
          caption: string
          comment_count: number | null
          created_at: string
          drive_deleted_at: string | null
          drive_file_id: string
          drive_file_name: string
          drive_file_size: number | null
          error: string | null
          id: string
          ig_container_id: string | null
          ig_media_id: string | null
          like_count: number | null
          locked_at: string | null
          media_type: Database["public"]["Enums"]["media_kind"]
          permalink: string | null
          public_url: string | null
          published_at: string | null
          scheduled_at: string | null
          stats_updated_at: string | null
          status: Database["public"]["Enums"]["post_status"]
          storage_path: string | null
          updated_at: string
          user_id: string
          view_count: number | null
        }
        Insert: {
          account_id: string
          attempts?: number
          caption?: string
          comment_count?: number | null
          created_at?: string
          drive_deleted_at?: string | null
          drive_file_id: string
          drive_file_name: string
          drive_file_size?: number | null
          error?: string | null
          id?: string
          ig_container_id?: string | null
          ig_media_id?: string | null
          like_count?: number | null
          locked_at?: string | null
          media_type?: Database["public"]["Enums"]["media_kind"]
          permalink?: string | null
          public_url?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          stats_updated_at?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          storage_path?: string | null
          updated_at?: string
          user_id?: string
          view_count?: number | null
        }
        Update: {
          account_id?: string
          attempts?: number
          caption?: string
          comment_count?: number | null
          created_at?: string
          drive_deleted_at?: string | null
          drive_file_id?: string
          drive_file_name?: string
          drive_file_size?: number | null
          error?: string | null
          id?: string
          ig_container_id?: string | null
          ig_media_id?: string | null
          like_count?: number | null
          locked_at?: string | null
          media_type?: Database["public"]["Enums"]["media_kind"]
          permalink?: string | null
          public_url?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          stats_updated_at?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          storage_path?: string | null
          updated_at?: string
          user_id?: string
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ig_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      seen_drive_files: {
        Row: {
          file_id: string
          folder_id: string
          id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          file_id: string
          folder_id: string
          id?: string
          seen_at?: string
          user_id?: string
        }
        Update: {
          file_id?: string
          folder_id?: string
          id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      watched_folders: {
        Row: {
          account_ids: string[]
          caption_template: string
          created_at: string
          enabled: boolean
          folder_id: string
          folder_name: string
          id: string
          last_scanned_at: string | null
          media_type: Database["public"]["Enums"]["media_kind"]
          user_id: string
        }
        Insert: {
          account_ids?: string[]
          caption_template?: string
          created_at?: string
          enabled?: boolean
          folder_id: string
          folder_name: string
          id?: string
          last_scanned_at?: string | null
          media_type?: Database["public"]["Enums"]["media_kind"]
          user_id?: string
        }
        Update: {
          account_ids?: string[]
          caption_template?: string
          created_at?: string
          enabled?: boolean
          folder_id?: string
          folder_name?: string
          id?: string
          last_scanned_at?: string | null
          media_type?: Database["public"]["Enums"]["media_kind"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      media_kind: "REELS" | "STORIES"
      post_status:
        | "queued"
        | "copying"
        | "copied"
        | "processing"
        | "published"
        | "failed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      media_kind: ["REELS", "STORIES"],
      post_status: [
        "queued",
        "copying",
        "copied",
        "processing",
        "published",
        "failed",
        "cancelled",
      ],
    },
  },
} as const
