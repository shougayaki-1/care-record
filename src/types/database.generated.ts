export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      assignments: {
        Row: {
          client_id: string
          created_at: string
          default_travel_cost_yen: number | null
          ghost_staff_id: string | null
          helper_id: string | null
          id: string
          round_trip_distance_km: number
          staff_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          default_travel_cost_yen?: number | null
          ghost_staff_id?: string | null
          helper_id?: string | null
          id?: string
          round_trip_distance_km?: number
          staff_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          default_travel_cost_yen?: number | null
          ghost_staff_id?: string | null
          helper_id?: string | null
          id?: string
          round_trip_distance_km?: number
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_ghost_staff_id_fkey"
            columns: ["ghost_staff_id"]
            isOneToOne: false
            referencedRelation: "staffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_helper_id_fkey"
            columns: ["helper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staffs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_archive_checkpoints: {
        Row: {
          destination: string
          last_created_at: string | null
          last_event_id: string | null
          updated_at: string
        }
        Insert: {
          destination: string
          last_created_at?: string | null
          last_event_id?: string | null
          updated_at?: string
        }
        Update: {
          destination?: string
          last_created_at?: string | null
          last_event_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action_type: string
          actor_id: string | null
          created_at: string
          details: Json
          event_hash: string | null
          event_id: string
          id: string
          integrity_version: number
          ip_hash: string | null
          organization_id: string | null
          outcome: string
          previous_hash: string | null
          reason: string | null
          request_id: string | null
          resource_id: string | null
          resource_type: string
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_hash?: string | null
          event_id?: string
          id?: string
          integrity_version?: number
          ip_hash?: string | null
          organization_id?: string | null
          outcome?: string
          previous_hash?: string | null
          reason?: string | null
          request_id?: string | null
          resource_id?: string | null
          resource_type: string
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_hash?: string | null
          event_id?: string
          id?: string
          integrity_version?: number
          ip_hash?: string | null
          organization_id?: string | null
          outcome?: string
          previous_hash?: string | null
          reason?: string | null
          request_id?: string | null
          resource_id?: string | null
          resource_type?: string
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action_type: string
          actor_id: string | null
          created_at: string | null
          details: Json | null
          id: string
          organization_id: string | null
          target_resource: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          organization_id?: string | null
          target_resource?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          organization_id?: string | null
          target_resource?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey_profiles"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_restore_tests: {
        Row: {
          achieved_rpo_minutes: number | null
          achieved_rto_minutes: number | null
          approved_by: string | null
          backup_reference: string
          environment: string
          expected_rpo_minutes: number
          expected_rto_minutes: number
          id: string
          integrity_verified: boolean
          notes: string | null
          performed_at: string
          result: string
        }
        Insert: {
          achieved_rpo_minutes?: number | null
          achieved_rto_minutes?: number | null
          approved_by?: string | null
          backup_reference: string
          environment: string
          expected_rpo_minutes: number
          expected_rto_minutes: number
          id?: string
          integrity_verified?: boolean
          notes?: string | null
          performed_at: string
          result: string
        }
        Update: {
          achieved_rpo_minutes?: number | null
          achieved_rto_minutes?: number | null
          approved_by?: string | null
          backup_reference?: string
          environment?: string
          expected_rpo_minutes?: number
          expected_rto_minutes?: number
          id?: string
          integrity_verified?: boolean
          notes?: string | null
          performed_at?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "backup_restore_tests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          google_folder_id: string | null
          google_template_id: string | null
          id: string
          name: string
          organization_id: string
          retention_until: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          google_folder_id?: string | null
          google_template_id?: string | null
          id?: string
          name: string
          organization_id: string
          retention_until?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          google_folder_id?: string | null
          google_template_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          retention_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_evidence: {
        Row: {
          approved_by: string | null
          artifact_sha256: string
          artifact_uri: string
          collected_at: string
          control_id: string
          evidence_type: string
          id: string
          notes: string | null
          valid_until: string | null
        }
        Insert: {
          approved_by?: string | null
          artifact_sha256: string
          artifact_uri: string
          collected_at?: string
          control_id: string
          evidence_type: string
          id?: string
          notes?: string | null
          valid_until?: string | null
        }
        Update: {
          approved_by?: string | null
          artifact_sha256?: string
          artifact_uri?: string
          collected_at?: string
          control_id?: string
          evidence_type?: string
          id?: string
          notes?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_evidence_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_risks: {
        Row: {
          accepted_until: string | null
          approved_by: string | null
          description: string
          due_at: string | null
          id: string
          impact: number
          likelihood: number
          owner_id: string | null
          reviewed_at: string
          risk_key: string
          status: string
          treatment: string
        }
        Insert: {
          accepted_until?: string | null
          approved_by?: string | null
          description: string
          due_at?: string | null
          id?: string
          impact: number
          likelihood: number
          owner_id?: string | null
          reviewed_at?: string
          risk_key: string
          status: string
          treatment: string
        }
        Update: {
          accepted_until?: string | null
          approved_by?: string | null
          description?: string
          due_at?: string | null
          id?: string
          impact?: number
          likelihood?: number
          owner_id?: string | null
          reviewed_at?: string
          risk_key?: string
          status?: string
          treatment?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_risks_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_risks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_requests: {
        Row: {
          approved_by: string | null
          completed_at: string | null
          decided_at: string | null
          id: string
          organization_id: string
          reason: string
          requested_at: string
          requested_by: string | null
          resource_id: string
          resource_type: string
          status: string
        }
        Insert: {
          approved_by?: string | null
          completed_at?: string | null
          decided_at?: string | null
          id?: string
          organization_id: string
          reason: string
          requested_at?: string
          requested_by?: string | null
          resource_id: string
          resource_type: string
          status?: string
        }
        Update: {
          approved_by?: string | null
          completed_at?: string | null
          decided_at?: string | null
          id?: string
          organization_id?: string
          reason?: string
          requested_at?: string
          requested_by?: string | null
          resource_id?: string
          resource_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "deletion_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deletion_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deletion_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      form_templates: {
        Row: {
          client_id: string
          id: string
          schema: Json
          updated_at: string
        }
        Insert: {
          client_id: string
          id?: string
          schema?: Json
          updated_at?: string
        }
        Update: {
          client_id?: string
          id?: string
          schema?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      google_sync_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          cursor: string | null
          failed_count: number
          id: string
          last_error_code: string | null
          organization_id: string
          phase: string
          processed_count: number
          requested_by: string
          status: string
          succeeded_count: number
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          cursor?: string | null
          failed_count?: number
          id?: string
          last_error_code?: string | null
          organization_id: string
          phase?: string
          processed_count?: number
          requested_by: string
          status?: string
          succeeded_count?: number
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          cursor?: string | null
          failed_count?: number
          id?: string
          last_error_code?: string | null
          organization_id?: string
          phase?: string
          processed_count?: number
          requested_by?: string
          status?: string
          succeeded_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_sync_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_work_records: {
        Row: {
          created_at: string
          deleted_at: string | null
          end_at: string
          id: string
          note: string | null
          organization_id: string
          recorded_by: string
          staff_id: string
          start_at: string
          status: string
          title: string
          updated_at: string
          work_hours: number
          work_type: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          end_at: string
          id?: string
          note?: string | null
          organization_id: string
          recorded_by: string
          staff_id: string
          start_at: string
          status?: string
          title: string
          updated_at?: string
          work_hours: number
          work_type?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          end_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          recorded_by?: string
          staff_id?: string
          start_at?: string
          status?: string
          title?: string
          updated_at?: string
          work_hours?: number
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_work_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_work_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_work_records_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staffs"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          email: string | null
          expires_at: string | null
          id: string
          is_used: boolean | null
          organization_id: string
          role: string | null
          role_ids: string[]
          staff_id: string | null
          target_client_ids: string[] | null
          target_name: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string | null
          id?: string
          is_used?: boolean | null
          organization_id: string
          role?: string | null
          role_ids?: string[]
          staff_id?: string | null
          target_client_ids?: string[] | null
          target_name?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string | null
          id?: string
          is_used?: boolean | null
          organization_id?: string
          role?: string | null
          role_ids?: string[]
          staff_id?: string | null
          target_client_ids?: string[] | null
          target_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staffs"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_premium_types: {
        Row: {
          builtin_type: string | null
          calc_method: string
          created_at: string
          display_order: number
          id: string
          is_enabled: boolean
          name: string
          night_end_hour: number | null
          night_start_hour: number | null
          organization_id: string
          overtime_daily_threshold_hours: number | null
          overtime_weekly_threshold_hours: number | null
          rate: number
          updated_at: string
          variable_overtime_period: string | null
          variable_overtime_threshold_hours: number | null
          variable_working_hours_enabled: boolean
        }
        Insert: {
          builtin_type?: string | null
          calc_method: string
          created_at?: string
          display_order?: number
          id?: string
          is_enabled?: boolean
          name: string
          night_end_hour?: number | null
          night_start_hour?: number | null
          organization_id: string
          overtime_daily_threshold_hours?: number | null
          overtime_weekly_threshold_hours?: number | null
          rate: number
          updated_at?: string
          variable_overtime_period?: string | null
          variable_overtime_threshold_hours?: number | null
          variable_working_hours_enabled?: boolean
        }
        Update: {
          builtin_type?: string | null
          calc_method?: string
          created_at?: string
          display_order?: number
          id?: string
          is_enabled?: boolean
          name?: string
          night_end_hour?: number | null
          night_start_hour?: number | null
          organization_id?: string
          overtime_daily_threshold_hours?: number | null
          overtime_weekly_threshold_hours?: number | null
          rate?: number
          updated_at?: string
          variable_overtime_period?: string | null
          variable_overtime_threshold_hours?: number | null
          variable_working_hours_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "labor_premium_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          created_at: string
          email_hash: string | null
          id: string
          ip_hash: string | null
          outcome: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email_hash?: string | null
          id?: string
          ip_hash?: string | null
          outcome?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email_hash?: string | null
          id?: string
          ip_hash?: string | null
          outcome?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      maintenance_run_items: {
        Row: {
          action: string
          after_hash: string | null
          before_state: Json
          created_at: string
          id: string
          resource_id: string
          resource_type: string
          result: string
          run_id: string
        }
        Insert: {
          action: string
          after_hash?: string | null
          before_state?: Json
          created_at?: string
          id?: string
          resource_id: string
          resource_type: string
          result?: string
          run_id: string
        }
        Update: {
          action?: string
          after_hash?: string | null
          before_state?: Json
          created_at?: string
          id?: string
          resource_id?: string
          resource_type?: string
          result?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "maintenance_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_runs: {
        Row: {
          applied_at: string | null
          created_at: string
          id: string
          kind: string
          organization_id: string
          requested_by: string | null
          status: string
          summary: Json
          target_month: string | null
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          id?: string
          kind: string
          organization_id: string
          requested_by?: string | null
          status: string
          summary?: Json
          target_month?: string | null
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          organization_id?: string
          requested_by?: string | null
          status?: string
          summary?: Json
          target_month?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_read: boolean | null
          link_url: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link_url?: string | null
          type: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link_url?: string | null
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      oauth_nonces: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          mode: string
          nonce_hash: string
          organization_id: string | null
          provider: string
          requires_google_identity_match: boolean
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          mode?: string
          nonce_hash: string
          organization_id?: string | null
          provider: string
          requires_google_identity_match?: boolean
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          mode?: string
          nonce_hash?: string
          organization_id?: string | null
          provider?: string
          requires_google_identity_match?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_nonces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_member_roles: {
        Row: {
          organization_id: string
          role_id: string
          user_id: string
        }
        Insert: {
          organization_id: string
          role_id: string
          user_id: string
        }
        Update: {
          organization_id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_member"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "organization_member_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "organization_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_roles: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_preset: boolean
          name: string
          organization_id: string
          permissions: Json
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_preset?: boolean
          name: string
          organization_id: string
          permissions?: Json
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_preset?: boolean
          name?: string
          organization_id?: string
          permissions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          google_calendar_id: string | null
          google_connection_checked_at: string | null
          google_connection_error_code: string | null
          google_connection_status: string
          google_folder_id: string | null
          google_refresh_token: string | null
          id: string
          name: string
          retention_until: string | null
          retention_years: number
          travel_cost_rate_yen_per_km: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          google_calendar_id?: string | null
          google_connection_checked_at?: string | null
          google_connection_error_code?: string | null
          google_connection_status?: string
          google_folder_id?: string | null
          google_refresh_token?: string | null
          id?: string
          name: string
          retention_until?: string | null
          retention_years?: number
          travel_cost_rate_yen_per_km?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          google_calendar_id?: string | null
          google_connection_checked_at?: string | null
          google_connection_error_code?: string | null
          google_connection_status?: string
          google_folder_id?: string | null
          google_refresh_token?: string | null
          id?: string
          name?: string
          retention_until?: string | null
          retention_years?: number
          travel_cost_rate_yen_per_km?: number
        }
        Relationships: [
          {
            foreignKeyName: "organizations_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          agreed_at: string | null
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          deletion_reason: string | null
          id: string
          is_agreed: boolean | null
          last_organization_id: string | null
          name: string
          role: string | null
        }
        Insert: {
          agreed_at?: string | null
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_reason?: string | null
          id: string
          is_agreed?: boolean | null
          last_organization_id?: string | null
          name: string
          role?: string | null
        }
        Update: {
          agreed_at?: string | null
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_reason?: string | null
          id?: string
          is_agreed?: boolean | null
          last_organization_id?: string | null
          name?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_organization_id_fkey"
            columns: ["last_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reauth_grants: {
        Row: {
          auth_session_id: string
          created_at: string
          expires_at: string
          purpose: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          auth_session_id: string
          created_at?: string
          expires_at: string
          purpose: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          auth_session_id?: string
          created_at?: string
          expires_at?: string
          purpose?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      record_versions: {
        Row: {
          actor_id: string | null
          change_reason: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          organization_id: string
          previous_hash: string | null
          resource_id: string
          resource_type: string
          session_id: string | null
          snapshot: Json
          snapshot_hash: string | null
          version_number: number
        }
        Insert: {
          actor_id?: string | null
          change_reason?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          organization_id: string
          previous_hash?: string | null
          resource_id: string
          resource_type: string
          session_id?: string | null
          snapshot: Json
          snapshot_hash?: string | null
          version_number: number
        }
        Update: {
          actor_id?: string | null
          change_reason?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          previous_hash?: string | null
          resource_id?: string
          resource_type?: string
          session_id?: string | null
          snapshot?: Json
          snapshot_hash?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "record_versions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_versions_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_actual_staffs: {
        Row: {
          created_at: string
          id: string
          report_id: string
          sort_order: number
          staff_id: string
          staff_role_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          report_id: string
          sort_order?: number
          staff_id: string
          staff_role_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          report_id?: string
          sort_order?: number
          staff_id?: string
          staff_role_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_actual_staffs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_actual_staffs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_actual_staffs_staff_role_id_fkey"
            columns: ["staff_role_id"]
            isOneToOne: false
            referencedRelation: "staff_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_autosaves: {
        Row: {
          autosave_revision: number
          base_content_revision: number | null
          client_id: string
          created_at: string
          draft_key: string
          editor_user_id: string
          expires_at: string
          id: string
          organization_id: string
          payload: Json
          report_id: string | null
          updated_at: string
        }
        Insert: {
          autosave_revision?: number
          base_content_revision?: number | null
          client_id: string
          created_at?: string
          draft_key: string
          editor_user_id: string
          expires_at?: string
          id?: string
          organization_id: string
          payload?: Json
          report_id?: string | null
          updated_at?: string
        }
        Update: {
          autosave_revision?: number
          base_content_revision?: number | null
          client_id?: string
          created_at?: string
          draft_key?: string
          editor_user_id?: string
          expires_at?: string
          id?: string
          organization_id?: string
          payload?: Json
          report_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_autosaves_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_autosaves_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_autosaves_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_corrections: {
        Row: {
          corrected_by: string
          corrected_revision_id: string
          created_at: string
          prior_revision_id: string
          reason: string
          report_id: string
        }
        Insert: {
          corrected_by: string
          corrected_revision_id: string
          created_at?: string
          prior_revision_id: string
          reason: string
          report_id: string
        }
        Update: {
          corrected_by?: string
          corrected_revision_id?: string
          created_at?: string
          prior_revision_id?: string
          reason?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_corrections_corrected_revision_id_fkey"
            columns: ["corrected_revision_id"]
            isOneToOne: false
            referencedRelation: "record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_corrections_prior_revision_id_fkey"
            columns: ["prior_revision_id"]
            isOneToOne: false
            referencedRelation: "record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_corrections_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_image_upload_events: {
        Row: {
          canceled_at: string | null
          completed_at: string | null
          created_at: string
          id: number
          report_id: string
          reservation_id: string
          user_id: string
        }
        Insert: {
          canceled_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: never
          report_id: string
          reservation_id?: string
          user_id: string
        }
        Update: {
          canceled_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: never
          report_id?: string
          reservation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_image_upload_events_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_images: {
        Row: {
          created_at: string | null
          id: string
          report_id: string | null
          storage_path: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          report_id?: string | null
          storage_path: string
        }
        Update: {
          created_at?: string | null
          id?: string
          report_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_images_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_mutation_keys: {
        Row: {
          actor_id: string
          created_at: string
          idempotency_key: string
          operation: string
          organization_id: string
          request_hash: string
          result: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          idempotency_key: string
          operation: string
          organization_id: string
          request_hash: string
          result: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          idempotency_key?: string
          operation?: string
          organization_id?: string
          request_hash?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "report_mutation_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_shifts: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          report_id: string
          shift_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          report_id: string
          shift_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          report_id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_shifts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_shifts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      report_values: {
        Row: {
          data: Json
          report_id: string
        }
        Insert: {
          data?: Json
          report_id: string
        }
        Update: {
          data?: Json
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_values_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          actual_service_type_id: string | null
          approved_at: string | null
          approved_by: string | null
          client_id: string
          content_revision: number
          created_at: string
          current_revision_id: string | null
          current_version: number
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          end_at: string | null
          end_time: string | null
          helper_id: string
          id: string
          legal_hold_at: string | null
          legal_hold_reason: string | null
          retention_until: string | null
          segment_id: string | null
          service_date: string | null
          shift_id: string | null
          start_at: string | null
          start_time: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          actual_service_type_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id: string
          content_revision?: number
          created_at?: string
          current_revision_id?: string | null
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          end_at?: string | null
          end_time?: string | null
          helper_id: string
          id?: string
          legal_hold_at?: string | null
          legal_hold_reason?: string | null
          retention_until?: string | null
          segment_id?: string | null
          service_date?: string | null
          shift_id?: string | null
          start_at?: string | null
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_service_type_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          content_revision?: number
          created_at?: string
          current_revision_id?: string | null
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          end_at?: string | null
          end_time?: string | null
          helper_id?: string
          id?: string
          legal_hold_at?: string | null
          legal_hold_reason?: string | null
          retention_until?: string | null
          segment_id?: string | null
          service_date?: string | null
          shift_id?: string | null
          start_at?: string | null
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_actual_service_type_id_fkey"
            columns: ["actual_service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_current_revision_id_fkey"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_helper_id_fkey"
            columns: ["helper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "shift_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_policies: {
        Row: {
          legal_basis: string
          organization_id: string
          resource_type: string
          retention_years: number
          reviewed_at: string
          reviewed_by: string | null
        }
        Insert: {
          legal_basis: string
          organization_id: string
          resource_type: string
          retention_years: number
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Update: {
          legal_basis?: string
          organization_id?: string
          resource_type?: string
          retention_years?: number
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_policies_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      security_incidents: {
        Row: {
          closed_at: string | null
          contained_at: string | null
          created_at: string
          detected_at: string
          id: string
          owner_id: string | null
          personal_data_impact: string | null
          regulator_reference: string | null
          severity: string
          status: string
          summary: string
        }
        Insert: {
          closed_at?: string | null
          contained_at?: string | null
          created_at?: string
          detected_at: string
          id?: string
          owner_id?: string | null
          personal_data_impact?: string | null
          regulator_reference?: string | null
          severity: string
          status: string
          summary: string
        }
        Update: {
          closed_at?: string | null
          contained_at?: string | null
          created_at?: string
          detected_at?: string
          id?: string
          owner_id?: string | null
          personal_data_impact?: string | null
          regulator_reference?: string | null
          severity?: string
          status?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_incidents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_types: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_pattern_segment_staffs: {
        Row: {
          created_at: string
          id: string
          segment_id: string
          staff_id: string
          staff_role_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          segment_id: string
          staff_id: string
          staff_role_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          segment_id?: string
          staff_id?: string
          staff_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_pattern_segment_staffs_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "shift_pattern_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_pattern_segment_staffs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_pattern_segment_staffs_staff_role_id_fkey"
            columns: ["staff_role_id"]
            isOneToOne: false
            referencedRelation: "staff_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_pattern_segments: {
        Row: {
          created_at: string
          end_time: string
          id: string
          pattern_id: string
          service_type_id: string | null
          sort_order: number
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          pattern_id: string
          service_type_id?: string | null
          sort_order?: number
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          pattern_id?: string
          service_type_id?: string | null
          sort_order?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_pattern_segments_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "shift_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_pattern_segments_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_pattern_staffs: {
        Row: {
          pattern_id: string
          staff_id: string
        }
        Insert: {
          pattern_id: string
          staff_id: string
        }
        Update: {
          pattern_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_pattern_staffs_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "shift_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_pattern_staffs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staffs"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_patterns: {
        Row: {
          client_id: string
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          effective_from: string | null
          effective_until: string | null
          end_time: string
          id: string
          organization_id: string
          retention_until: string | null
          rrule: string
          start_time: string
          supersedes_pattern_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          end_time: string
          id?: string
          organization_id: string
          retention_until?: string | null
          rrule: string
          start_time: string
          supersedes_pattern_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          effective_from?: string | null
          effective_until?: string | null
          end_time?: string
          id?: string
          organization_id?: string
          retention_until?: string | null
          rrule?: string
          start_time?: string
          supersedes_pattern_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_patterns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_patterns_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_patterns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_patterns_supersedes_pattern_id_fkey"
            columns: ["supersedes_pattern_id"]
            isOneToOne: false
            referencedRelation: "shift_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_segment_staffs: {
        Row: {
          created_at: string
          id: string
          segment_id: string
          staff_id: string
          staff_role_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          segment_id: string
          staff_id: string
          staff_role_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          segment_id?: string
          staff_id?: string
          staff_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_segment_staffs_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "shift_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_segment_staffs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_segment_staffs_staff_role_id_fkey"
            columns: ["staff_role_id"]
            isOneToOne: false
            referencedRelation: "staff_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_segments: {
        Row: {
          created_at: string
          end_at: string
          id: string
          service_type_id: string | null
          shift_id: string
          sort_order: number
          source_pattern_segment_id: string | null
          start_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_at: string
          id?: string
          service_type_id?: string | null
          shift_id: string
          sort_order?: number
          source_pattern_segment_id?: string | null
          start_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_at?: string
          id?: string
          service_type_id?: string | null
          shift_id?: string
          sort_order?: number
          source_pattern_segment_id?: string | null
          start_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_segments_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_segments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_segments_source_pattern_segment_id_fkey"
            columns: ["source_pattern_segment_id"]
            isOneToOne: false
            referencedRelation: "shift_pattern_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_staffs: {
        Row: {
          created_at: string | null
          shift_id: string
          staff_id: string
        }
        Insert: {
          created_at?: string | null
          shift_id: string
          staff_id: string
        }
        Update: {
          created_at?: string | null
          shift_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_staffs_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_staffs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staffs"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          base_shift_id: string | null
          cancel_reason: string | null
          client_id: string
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          end_at: string
          google_event_id: string | null
          google_sync_error: string | null
          google_sync_status: string | null
          google_synced_at: string | null
          id: string
          is_modified: boolean | null
          is_recurring: boolean | null
          legal_hold_at: string | null
          organization_id: string
          pattern_id: string | null
          retention_until: string | null
          rrule: string | null
          start_at: string
          status: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          base_shift_id?: string | null
          cancel_reason?: string | null
          client_id: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          end_at: string
          google_event_id?: string | null
          google_sync_error?: string | null
          google_sync_status?: string | null
          google_synced_at?: string | null
          id?: string
          is_modified?: boolean | null
          is_recurring?: boolean | null
          legal_hold_at?: string | null
          organization_id: string
          pattern_id?: string | null
          retention_until?: string | null
          rrule?: string | null
          start_at: string
          status?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          base_shift_id?: string | null
          cancel_reason?: string | null
          client_id?: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          end_at?: string
          google_event_id?: string | null
          google_sync_error?: string | null
          google_sync_status?: string | null
          google_synced_at?: string | null
          id?: string
          is_modified?: boolean | null
          is_recurring?: boolean | null
          legal_hold_at?: string | null
          organization_id?: string
          pattern_id?: string | null
          retention_until?: string | null
          rrule?: string | null
          start_at?: string
          status?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_base_shift_id_fkey"
            columns: ["base_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_position_presets: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_position_presets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_roles: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          is_unpaid: boolean
          name: string
          organization_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          is_unpaid?: boolean
          name: string
          organization_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          is_unpaid?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staffs: {
        Row: {
          archived_at: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          employment_type: string | null
          id: string
          name: string
          organization_id: string
          positions: string[] | null
          retention_until: string | null
          sort_order: number | null
          updated_at: string | null
          user_id: string | null
          work_style: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          employment_type?: string | null
          id?: string
          name: string
          organization_id: string
          positions?: string[] | null
          retention_until?: string | null
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string | null
          work_style?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          employment_type?: string | null
          id?: string
          name?: string
          organization_id?: string
          positions?: string[] | null
          retention_until?: string | null
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string | null
          work_style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghost_staffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staffs_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staffs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stepup_reauth_challenges: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          nonce_hash: string
          provider: string
          purpose: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          nonce_hash: string
          provider: string
          purpose: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          nonce_hash?: string
          provider?: string
          purpose?: string
          user_id?: string
        }
        Relationships: []
      }
      user_deletion_requests: {
        Row: {
          approved_by: string | null
          completed_at: string | null
          decided_at: string | null
          id: string
          requested_at: string
          retention_basis: string
          status: string
          user_id: string
        }
        Insert: {
          approved_by?: string | null
          completed_at?: string | null
          decided_at?: string | null
          id?: string
          requested_at?: string
          retention_basis: string
          status?: string
          user_id: string
        }
        Update: {
          approved_by?: string | null
          completed_at?: string | null
          decided_at?: string | null
          id?: string
          requested_at?: string
          retention_basis?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_deletion_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_session_activity: {
        Row: {
          absolute_expires_at: string
          auth_session_id: string
          created_at: string
          last_activity: string
          revoked_at: string | null
          session_hash: string
          user_id: string
        }
        Insert: {
          absolute_expires_at: string
          auth_session_id: string
          created_at?: string
          last_activity?: string
          revoked_at?: string | null
          session_hash: string
          user_id: string
        }
        Update: {
          absolute_expires_at?: string
          auth_session_id?: string
          created_at?: string
          last_activity?: string
          revoked_at?: string | null
          session_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      vendor_registry: {
        Row: {
          approved_by: string | null
          contract_reviewed_at: string | null
          data_categories: string[]
          exit_plan: string
          id: string
          next_review_at: string | null
          processing_countries: string[]
          security_assessment_uri: string | null
          service_name: string
          subprocessors_uri: string | null
          vendor_name: string
        }
        Insert: {
          approved_by?: string | null
          contract_reviewed_at?: string | null
          data_categories?: string[]
          exit_plan: string
          id?: string
          next_review_at?: string | null
          processing_countries?: string[]
          security_assessment_uri?: string | null
          service_name: string
          subprocessors_uri?: string | null
          vendor_name: string
        }
        Update: {
          approved_by?: string | null
          contract_reviewed_at?: string | null
          data_categories?: string[]
          exit_plan?: string
          id?: string
          next_review_at?: string | null
          processing_countries?: string[]
          security_assessment_uri?: string | null
          service_name?: string
          subprocessors_uri?: string | null
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_registry_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation_atomic: {
        Args: { p_code: string; p_session_id?: string }
        Returns: string
      }
      accept_invitation_atomic_email_checked_internal: {
        Args: { p_code: string; p_session_id?: string }
        Returns: string
      }
      account_remove: {
        Args: {
          p_organization_id: string
          p_status: string
          p_target_id: string
        }
        Returns: undefined
      }
      account_replace_member_roles: {
        Args: {
          p_organization_id: string
          p_role_ids: string[]
          p_target_user_id: string
        }
        Returns: undefined
      }
      account_update_role: {
        Args: {
          p_new_role: string
          p_organization_id: string
          p_status: string
          p_target_id: string
        }
        Returns: undefined
      }
      add_report_shift_link: {
        Args: { p_org_id: string; p_report_id: string; p_shift_id: string }
        Returns: undefined
      }
      complete_google_oauth_connection: {
        Args: {
          p_calendar_id: string
          p_encrypted_refresh_token: string
          p_org_id: string
          p_status: string
        }
        Returns: undefined
      }
      create_invitation_authorized: {
        Args: {
          p_code: string
          p_email: string
          p_organization_id: string
          p_role_ids?: string[]
          p_staff_id?: string
          p_target_name: string
        }
        Returns: undefined
      }
      create_labor_premium_type_atomic: {
        Args: {
          p_calc_method: string
          p_name: string
          p_night_end_hour: number
          p_night_start_hour: number
          p_organization_id: string
          p_rate: number
          p_variable_overtime_period?: string
          p_variable_overtime_threshold_hours?: number
          p_variable_working_hours_enabled?: boolean
        }
        Returns: string
      }
      create_organization: { Args: { org_name: string }; Returns: string }
      create_service_type_atomic: {
        Args: { p_name: string; p_organization_id: string }
        Returns: string
      }
      create_shift_with_segments_atomic: {
        Args: { p_org_id: string; p_payload: Json }
        Returns: string
      }
      create_staff_role_atomic: {
        Args: {
          p_is_unpaid?: boolean
          p_name: string
          p_organization_id: string
        }
        Returns: string
      }
      current_user_has_password: { Args: never; Returns: boolean }
      decide_report_deletion: {
        Args: { p_decision: string; p_org_id: string; p_request_id: string }
        Returns: Json
      }
      delete_shift_segment_atomic: {
        Args: { p_org_id: string; p_segment_id: string }
        Returns: undefined
      }
      discard_report_autosave_authorized: {
        Args: { p_draft_key: string; p_organization_id: string }
        Returns: undefined
      }
      finish_report_image_upload: {
        Args: { p_completed: boolean; p_reservation_id: string }
        Returns: undefined
      }
      get_client_assignment_permission_hints_authorized: {
        Args: { p_client_id: string; p_organization_id: string }
        Returns: {
          can_create_all_records: boolean
          role_names: string[]
          staff_id: string
          user_id: string
        }[]
      }
      get_database_capacity_status: { Args: never; Returns: Json }
      get_google_oauth_context: { Args: { p_org_id: string }; Returns: Json }
      get_google_sync_target: {
        Args: { p_org_id: string; p_shift_id: string }
        Returns: Json
      }
      get_invitation_preview: { Args: { p_code: string }; Returns: Json }
      get_my_org_id: { Args: never; Returns: string }
      is_org_admin: { Args: { _org_id: string }; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      leave_organization_atomic: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      load_report_autosave_authorized: {
        Args: { p_draft_key: string; p_organization_id: string }
        Returns: Json
      }
      mark_shift_google_sync: {
        Args: {
          p_error: string
          p_event_id: string
          p_set_event_id: boolean
          p_shift_id: string
          p_status: string
        }
        Returns: undefined
      }
      mutate_organization_role_authorized: {
        Args: {
          p_action: string
          p_color: string
          p_name: string
          p_organization_id: string
          p_permissions: Json
          p_require_preset: boolean
          p_role_id: string
        }
        Returns: string
      }
      refresh_shift_staffs: { Args: { p_shift_id: string }; Returns: undefined }
      refresh_shift_title: { Args: { p_shift_id: string }; Returns: undefined }
      remove_report_shift_link: {
        Args: { p_org_id: string; p_report_id: string; p_shift_id: string }
        Returns: undefined
      }
      reorder_staffs_authorized: {
        Args: { p_organization_id: string; p_staff_ids: string[] }
        Returns: undefined
      }
      replace_client_assignments_authorized: {
        Args: {
          p_client_id: string
          p_distances?: Json
          p_organization_id: string
          p_staff_ids: string[]
        }
        Returns: undefined
      }
      replace_client_assignments_with_costs_authorized: {
        Args: {
          p_client_id: string
          p_costs: Json
          p_organization_id: string
          p_staff_ids: string[]
        }
        Returns: undefined
      }
      replace_generated_shift_segments_atomic: {
        Args: { p_segments: Json; p_shift_id: string }
        Returns: undefined
      }
      replace_pattern_segments_atomic: {
        Args: { p_pattern_id: string; p_segments: Json }
        Returns: undefined
      }
      replace_pattern_staffs_atomic: {
        Args: { p_pattern_id: string; p_staff_ids: string[] }
        Returns: undefined
      }
      replace_shift_segments: {
        Args: { p_org_id: string; p_segments: Json; p_shift_id: string }
        Returns: undefined
      }
      replace_shift_staffs_atomic: {
        Args: { p_shift_id: string; p_staff_ids: string[] }
        Returns: undefined
      }
      request_own_account_deletion: {
        Args: { p_retention_basis: string }
        Returns: undefined
      }
      request_report_deletion: {
        Args: { p_org_id: string; p_reason: string; p_report_id: string }
        Returns: string
      }
      reserve_report_image_upload: {
        Args: { p_report_id: string }
        Returns: string
      }
      restore_reports_authorized: {
        Args: { p_organization_id: string; p_report_ids: string[] }
        Returns: undefined
      }
      save_generated_shift_atomic: {
        Args: { p_org_id: string; p_payload: Json; p_shift_id: string }
        Returns: string
      }
      save_report_atomic: {
        Args: {
          p_actual_service_type_id?: string
          p_actual_staffs?: Json
          p_client_id: string
          p_end_at: string
          p_organization_id: string
          p_report_id: string
          p_segment_id: string
          p_session_id?: string
          p_shift_id: string
          p_start_at: string
          p_status: string
          p_values: Json
        }
        Returns: string
      }
      save_report_atomic_v2: {
        Args: {
          p_actual_service_type_id?: string
          p_actual_staffs?: Json
          p_client_id: string
          p_end_at: string
          p_organization_id: string
          p_report_id: string
          p_segment_id: string
          p_session_id?: string
          p_shift_id: string
          p_start_at: string
          p_status: string
          p_values: Json
        }
        Returns: string
      }
      save_report_autosave_authorized: {
        Args: {
          p_autosave_revision: number
          p_base_content_revision: number
          p_client_id: string
          p_draft_key: string
          p_organization_id: string
          p_payload: Json
          p_report_id: string
        }
        Returns: Json
      }
      save_report_versioned: {
        Args: {
          p_actual_service_type_id?: string
          p_actual_staffs?: Json
          p_client_id: string
          p_correction_reason?: string
          p_end_at: string
          p_expected_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_report_id: string
          p_segment_id: string
          p_session_id?: string
          p_shift_id: string
          p_start_at: string
          p_status: string
          p_values: Json
        }
        Returns: Json
      }
      save_shift_pattern_atomic: {
        Args: { p_org_id: string; p_pattern_id: string; p_payload: Json }
        Returns: string
      }
      soft_delete_organization: { Args: { p_org_id: string }; Returns: string }
      soft_delete_reports_authorized: {
        Args: {
          p_organization_id: string
          p_reason: string
          p_report_ids: string[]
        }
        Returns: Json
      }
      soft_delete_shifts_atomic: {
        Args: {
          p_org_id: string
          p_reason: string
          p_retention_until: string
          p_shift_ids: string[]
          p_sync_status: string
        }
        Returns: number
      }
      transfer_owner_atomic: {
        Args: {
          p_current_owner_id: string
          p_new_owner_id: string
          p_org_id: string
        }
        Returns: undefined
      }
      transition_reports_authorized: {
        Args: {
          p_organization_id: string
          p_report_ids: string[]
          p_transition: string
        }
        Returns: undefined
      }
      update_google_connection_health: {
        Args: { p_error_code: string; p_org_id: string; p_status: string }
        Returns: undefined
      }
      update_organization_setting: {
        Args: { p_org_id: string; p_setting: string; p_value: string }
        Returns: undefined
      }
      upsert_client_form_authorized: {
        Args: { p_client_id: string; p_organization_id: string; p_schema: Json }
        Returns: undefined
      }
      upsert_shift_assignments_atomic: {
        Args: { p_client_id: string; p_org_id: string; p_staff_ids: string[] }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
