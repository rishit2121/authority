export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      agent_auth_events: {
        Row: {
          agent_id: string | null;
          attempted_key_prefix: string | null;
          created_at: string;
          credential_id: string | null;
          id: string;
          outcome: Database["public"]["Enums"]["agent_auth_outcome"];
          tenant_id: string | null;
        };
        Insert: {
          agent_id?: string | null;
          attempted_key_prefix?: string | null;
          created_at?: string;
          credential_id?: string | null;
          id?: string;
          outcome: Database["public"]["Enums"]["agent_auth_outcome"];
          tenant_id?: string | null;
        };
        Update: {
          agent_id?: string | null;
          attempted_key_prefix?: string | null;
          created_at?: string;
          credential_id?: string | null;
          id?: string;
          outcome?: Database["public"]["Enums"]["agent_auth_outcome"];
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_auth_events_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "agent_auth_events_credential_id_tenant_id_fkey";
            columns: ["credential_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agent_credentials";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "agent_auth_events_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_credentials: {
        Row: {
          agent_id: string;
          created_at: string;
          created_by_principal_id: string | null;
          id: string;
          key_hash: string;
          key_prefix: string;
          last_used_at: string | null;
          revocation_reason: string | null;
          revoked_at: string | null;
          revoked_by_principal_id: string | null;
          status: Database["public"]["Enums"]["agent_credential_status"];
          tenant_id: string;
        };
        Insert: {
          agent_id: string;
          created_at?: string;
          created_by_principal_id?: string | null;
          id?: string;
          key_hash: string;
          key_prefix: string;
          last_used_at?: string | null;
          revocation_reason?: string | null;
          revoked_at?: string | null;
          revoked_by_principal_id?: string | null;
          status?: Database["public"]["Enums"]["agent_credential_status"];
          tenant_id: string;
        };
        Update: {
          agent_id?: string;
          created_at?: string;
          created_by_principal_id?: string | null;
          id?: string;
          key_hash?: string;
          key_prefix?: string;
          last_used_at?: string | null;
          revocation_reason?: string | null;
          revoked_at?: string | null;
          revoked_by_principal_id?: string | null;
          status?: Database["public"]["Enums"]["agent_credential_status"];
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_credentials_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "agent_credentials_created_by_principal_id_tenant_id_fkey";
            columns: ["created_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "agent_credentials_revoked_by_principal_id_tenant_id_fkey";
            columns: ["revoked_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "agent_credentials_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      agents: {
        Row: {
          created_at: string;
          demo_key: string | null;
          description: string | null;
          environment: Database["public"]["Enums"]["tenant_environment"];
          framework: string;
          id: string;
          model: string;
          model_provider: string;
          name: string;
          owner_principal_id: string;
          risk_tier: Database["public"]["Enums"]["agent_risk_tier"];
          status: Database["public"]["Enums"]["agent_status"];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          demo_key?: string | null;
          description?: string | null;
          environment?: Database["public"]["Enums"]["tenant_environment"];
          framework: string;
          id?: string;
          model: string;
          model_provider: string;
          name: string;
          owner_principal_id: string;
          risk_tier?: Database["public"]["Enums"]["agent_risk_tier"];
          status?: Database["public"]["Enums"]["agent_status"];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          demo_key?: string | null;
          description?: string | null;
          environment?: Database["public"]["Enums"]["tenant_environment"];
          framework?: string;
          id?: string;
          model?: string;
          model_provider?: string;
          name?: string;
          owner_principal_id?: string;
          risk_tier?: Database["public"]["Enums"]["agent_risk_tier"];
          status?: Database["public"]["Enums"]["agent_status"];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agents_owner_principal_id_tenant_id_fkey";
            columns: ["owner_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "agents_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      approvals: {
        Row: {
          assigned_approver_principal_id: string | null;
          authorization_decision_id: string | null;
          compiler_version: string | null;
          contract_id: string | null;
          contract_version: number | null;
          created_at: string;
          decided_at: string | null;
          decision_reason: string | null;
          demo_key: string | null;
          id: string;
          input_hash: string | null;
          output_hash: string | null;
          plan_id: string | null;
          registry_version: string | null;
          requested_at: string;
          requested_authority_delta: Json | null;
          requested_by: string | null;
          requested_from_principal_id: string | null;
          required_kind: Database["public"]["Enums"]["approval_requirement_kind"] | null;
          required_role: Database["public"]["Enums"]["tenant_role"] | null;
          responded_by_principal_id: string | null;
          self_approval_allowed: boolean;
          slot_index: number | null;
          status: Database["public"]["Enums"]["approval_status"];
          summary: string;
          task_id: string;
          tenant_id: string;
        };
        Insert: {
          assigned_approver_principal_id?: string | null;
          authorization_decision_id?: string | null;
          compiler_version?: string | null;
          contract_id?: string | null;
          contract_version?: number | null;
          created_at?: string;
          decided_at?: string | null;
          decision_reason?: string | null;
          demo_key?: string | null;
          id?: string;
          input_hash?: string | null;
          output_hash?: string | null;
          plan_id?: string | null;
          registry_version?: string | null;
          requested_at?: string;
          requested_authority_delta?: Json | null;
          requested_by?: string | null;
          requested_from_principal_id?: string | null;
          required_kind?: Database["public"]["Enums"]["approval_requirement_kind"] | null;
          required_role?: Database["public"]["Enums"]["tenant_role"] | null;
          responded_by_principal_id?: string | null;
          self_approval_allowed?: boolean;
          slot_index?: number | null;
          status?: Database["public"]["Enums"]["approval_status"];
          summary: string;
          task_id: string;
          tenant_id: string;
        };
        Update: {
          assigned_approver_principal_id?: string | null;
          authorization_decision_id?: string | null;
          compiler_version?: string | null;
          contract_id?: string | null;
          contract_version?: number | null;
          created_at?: string;
          decided_at?: string | null;
          decision_reason?: string | null;
          demo_key?: string | null;
          id?: string;
          input_hash?: string | null;
          output_hash?: string | null;
          plan_id?: string | null;
          registry_version?: string | null;
          requested_at?: string;
          requested_authority_delta?: Json | null;
          requested_by?: string | null;
          requested_from_principal_id?: string | null;
          required_kind?: Database["public"]["Enums"]["approval_requirement_kind"] | null;
          required_role?: Database["public"]["Enums"]["tenant_role"] | null;
          responded_by_principal_id?: string | null;
          self_approval_allowed?: boolean;
          slot_index?: number | null;
          status?: Database["public"]["Enums"]["approval_status"];
          summary?: string;
          task_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approvals_assigned_approver_principal_id_tenant_id_fkey";
            columns: ["assigned_approver_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "approvals_authorization_decision_id_tenant_id_fkey";
            columns: ["authorization_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "authorization_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "approvals_contract_fk";
            columns: ["contract_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "task_authority_contracts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "approvals_plan_fk";
            columns: ["plan_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "approvals_requested_from_principal_id_tenant_id_fkey";
            columns: ["requested_from_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "approvals_responded_by_principal_id_tenant_id_fkey";
            columns: ["responded_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "approvals_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "approvals_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      authorization_decisions: {
        Row: {
          applied_constraints: Json;
          capability_id: string | null;
          contract_id: string | null;
          contract_version: number | null;
          created_at: string;
          demo_key: string | null;
          evidence_references: Json | null;
          id: string;
          latency_ms: number;
          matched_policy_ids: string[];
          outcome: Database["public"]["Enums"]["authorization_outcome"];
          reason_codes: Json;
          semantic_decision_id: string | null;
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Insert: {
          applied_constraints?: Json;
          capability_id?: string | null;
          contract_id?: string | null;
          contract_version?: number | null;
          created_at?: string;
          demo_key?: string | null;
          evidence_references?: Json | null;
          id?: string;
          latency_ms: number;
          matched_policy_ids?: string[];
          outcome: Database["public"]["Enums"]["authorization_outcome"];
          reason_codes: Json;
          semantic_decision_id?: string | null;
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Update: {
          applied_constraints?: Json;
          capability_id?: string | null;
          contract_id?: string | null;
          contract_version?: number | null;
          created_at?: string;
          demo_key?: string | null;
          evidence_references?: Json | null;
          id?: string;
          latency_ms?: number;
          matched_policy_ids?: string[];
          outcome?: Database["public"]["Enums"]["authorization_outcome"];
          reason_codes?: Json;
          semantic_decision_id?: string | null;
          task_id?: string;
          tenant_id?: string;
          tool_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "authorization_decisions_capability_fk";
            columns: ["capability_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "capabilities";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "authorization_decisions_contract_id_tenant_id_fkey";
            columns: ["contract_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "task_authority_contracts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "authorization_decisions_semantic_decision_id_tenant_id_fkey";
            columns: ["semantic_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "semantic_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "authorization_decisions_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "authorization_decisions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "authorization_decisions_tool_request_id_tenant_id_fkey";
            columns: ["tool_request_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tool_requests";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      capabilities: {
        Row: {
          agent_id: string;
          argument_constraints: Json | null;
          authorization_decision_id: string;
          consumed_uses: number;
          contract_id: string | null;
          demo_key: string | null;
          expires_at: string;
          id: string;
          issued_at: string;
          max_invocations: number;
          resource_constraints: Json;
          revocation_reason: string | null;
          revoked_at: string | null;
          status: Database["public"]["Enums"]["capability_status"];
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Insert: {
          agent_id: string;
          argument_constraints?: Json | null;
          authorization_decision_id: string;
          consumed_uses?: number;
          contract_id?: string | null;
          demo_key?: string | null;
          expires_at: string;
          id?: string;
          issued_at?: string;
          max_invocations: number;
          resource_constraints?: Json;
          revocation_reason?: string | null;
          revoked_at?: string | null;
          status?: Database["public"]["Enums"]["capability_status"];
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Update: {
          agent_id?: string;
          argument_constraints?: Json | null;
          authorization_decision_id?: string;
          consumed_uses?: number;
          contract_id?: string | null;
          demo_key?: string | null;
          expires_at?: string;
          id?: string;
          issued_at?: string;
          max_invocations?: number;
          resource_constraints?: Json;
          revocation_reason?: string | null;
          revoked_at?: string | null;
          status?: Database["public"]["Enums"]["capability_status"];
          task_id?: string;
          tenant_id?: string;
          tool?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capabilities_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capabilities_authorization_decision_id_tenant_id_fkey";
            columns: ["authorization_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "authorization_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capabilities_contract_fk";
            columns: ["contract_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "task_authority_contracts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capabilities_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capabilities_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      capability_consumptions: {
        Row: {
          agent_id: string;
          capability_id: string;
          created_at: string;
          id: string;
          idempotency_key: string;
          reason_code: string;
          request_hash: string;
          result: string;
          simulated: boolean;
          tenant_id: string;
          use_number: number | null;
        };
        Insert: {
          agent_id: string;
          capability_id: string;
          created_at?: string;
          id?: string;
          idempotency_key: string;
          reason_code: string;
          request_hash: string;
          result: string;
          simulated?: boolean;
          tenant_id: string;
          use_number?: number | null;
        };
        Update: {
          agent_id?: string;
          capability_id?: string;
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          reason_code?: string;
          request_hash?: string;
          result?: string;
          simulated?: boolean;
          tenant_id?: string;
          use_number?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "capability_consumptions_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_consumptions_capability_id_tenant_id_fkey";
            columns: ["capability_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "capability_tokens";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_consumptions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      capability_reservations: {
        Row: {
          agent_id: string;
          capability_id: string;
          created_at: string;
          dispatched_at: string | null;
          execution_mode: string;
          finished_at: string | null;
          github_installation_id: number | null;
          id: string;
          idempotency_key: string;
          installation_row_id: string | null;
          lease_expires_at: string;
          operation: string;
          reason_code: string | null;
          repository_full_name: string | null;
          repository_id: string | null;
          request_hash: string;
          reserved_at: string;
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by_principal_id: string | null;
          resolved_outcome: string | null;
          status: string;
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Insert: {
          agent_id: string;
          capability_id: string;
          created_at?: string;
          dispatched_at?: string | null;
          execution_mode: string;
          finished_at?: string | null;
          github_installation_id?: number | null;
          id?: string;
          idempotency_key: string;
          installation_row_id?: string | null;
          lease_expires_at: string;
          operation: string;
          reason_code?: string | null;
          repository_full_name?: string | null;
          repository_id?: string | null;
          request_hash: string;
          reserved_at?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by_principal_id?: string | null;
          resolved_outcome?: string | null;
          status?: string;
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Update: {
          agent_id?: string;
          capability_id?: string;
          created_at?: string;
          dispatched_at?: string | null;
          execution_mode?: string;
          finished_at?: string | null;
          github_installation_id?: number | null;
          id?: string;
          idempotency_key?: string;
          installation_row_id?: string | null;
          lease_expires_at?: string;
          operation?: string;
          reason_code?: string | null;
          repository_full_name?: string | null;
          repository_id?: string | null;
          request_hash?: string;
          reserved_at?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by_principal_id?: string | null;
          resolved_outcome?: string | null;
          status?: string;
          task_id?: string;
          tenant_id?: string;
          tool?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capability_reservations_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_reservations_capability_id_tenant_id_fkey";
            columns: ["capability_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "capability_tokens";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_reservations_installation_row_id_tenant_id_fkey";
            columns: ["installation_row_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "github_installations";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_reservations_repository_id_tenant_id_fkey";
            columns: ["repository_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "github_repositories";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_reservations_resolved_by_principal_id_tenant_id_fkey";
            columns: ["resolved_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_reservations_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_reservations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      capability_tokens: {
        Row: {
          agent_id: string;
          approval_request_id: string | null;
          arguments_hash: string;
          authorization_decision_id: string;
          budget_capability_id: string;
          budget_released_uses: number;
          contract_id: string;
          contract_version: number;
          credential_id: string;
          expires_at: string;
          final_decision_id: string;
          format_version: number;
          id: string;
          issued_at: string;
          max_uses: number;
          operation: string;
          reserved_uses: number;
          resource: string | null;
          resource_constraints: Json;
          revocation_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          revoked_by_principal_id: string | null;
          status: string;
          task_id: string;
          tenant_id: string;
          token_hash: string;
          tool: string;
          uses: number;
        };
        Insert: {
          agent_id: string;
          approval_request_id?: string | null;
          arguments_hash: string;
          authorization_decision_id: string;
          budget_capability_id: string;
          budget_released_uses?: number;
          contract_id: string;
          contract_version: number;
          credential_id: string;
          expires_at: string;
          final_decision_id: string;
          format_version?: number;
          id?: string;
          issued_at?: string;
          max_uses: number;
          operation: string;
          reserved_uses?: number;
          resource?: string | null;
          resource_constraints: Json;
          revocation_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_by_principal_id?: string | null;
          status?: string;
          task_id: string;
          tenant_id: string;
          token_hash: string;
          tool: string;
          uses?: number;
        };
        Update: {
          agent_id?: string;
          approval_request_id?: string | null;
          arguments_hash?: string;
          authorization_decision_id?: string;
          budget_capability_id?: string;
          budget_released_uses?: number;
          contract_id?: string;
          contract_version?: number;
          credential_id?: string;
          expires_at?: string;
          final_decision_id?: string;
          format_version?: number;
          id?: string;
          issued_at?: string;
          max_uses?: number;
          operation?: string;
          reserved_uses?: number;
          resource?: string | null;
          resource_constraints?: Json;
          revocation_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_by_principal_id?: string | null;
          status?: string;
          task_id?: string;
          tenant_id?: string;
          token_hash?: string;
          tool?: string;
          uses?: number;
        };
        Relationships: [
          {
            foreignKeyName: "capability_tokens_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_tokens_approval_fk";
            columns: ["approval_request_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "runtime_approval_requests";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_tokens_authorization_decision_id_tenant_id_fkey";
            columns: ["authorization_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "authorization_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_tokens_budget_capability_id_tenant_id_fkey";
            columns: ["budget_capability_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "capabilities";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_tokens_contract_id_tenant_id_fkey";
            columns: ["contract_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "task_authority_contracts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_tokens_credential_id_tenant_id_fkey";
            columns: ["credential_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agent_credentials";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_tokens_final_decision_id_tenant_id_fkey";
            columns: ["final_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "final_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_tokens_revoked_by_principal_id_tenant_id_fkey";
            columns: ["revoked_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_tokens_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "capability_tokens_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      contract_compilations: {
        Row: {
          compiler_version: string;
          contract_id: string;
          created_at: string;
          id: string;
          input_hash: string;
          objective_trace: Json;
          output_hash: string;
          plan_id: string;
          registry_version: string;
          task_id: string;
          tenant_id: string;
          verifier_result: Json;
        };
        Insert: {
          compiler_version: string;
          contract_id: string;
          created_at?: string;
          id?: string;
          input_hash: string;
          objective_trace: Json;
          output_hash: string;
          plan_id: string;
          registry_version: string;
          task_id: string;
          tenant_id: string;
          verifier_result: Json;
        };
        Update: {
          compiler_version?: string;
          contract_id?: string;
          created_at?: string;
          id?: string;
          input_hash?: string;
          objective_trace?: Json;
          output_hash?: string;
          plan_id?: string;
          registry_version?: string;
          task_id?: string;
          tenant_id?: string;
          verifier_result?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "contract_compilations_contract_id_tenant_id_fkey";
            columns: ["contract_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "task_authority_contracts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "contract_compilations_plan_id_tenant_id_fkey";
            columns: ["plan_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "contract_compilations_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "contract_compilations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      execution_events: {
        Row: {
          capability_id: string | null;
          created_at: string;
          decision_id: string | null;
          demo_key: string | null;
          detail: string | null;
          event_type: Database["public"]["Enums"]["execution_event_type"];
          id: string;
          normalized_effect_metadata: Json | null;
          receipt_metadata: Json | null;
          result_status: Database["public"]["Enums"]["execution_outcome"];
          summary: string;
          task_id: string;
          tenant_id: string;
          tool_request_id: string | null;
        };
        Insert: {
          capability_id?: string | null;
          created_at?: string;
          decision_id?: string | null;
          demo_key?: string | null;
          detail?: string | null;
          event_type: Database["public"]["Enums"]["execution_event_type"];
          id?: string;
          normalized_effect_metadata?: Json | null;
          receipt_metadata?: Json | null;
          result_status: Database["public"]["Enums"]["execution_outcome"];
          summary: string;
          task_id: string;
          tenant_id: string;
          tool_request_id?: string | null;
        };
        Update: {
          capability_id?: string | null;
          created_at?: string;
          decision_id?: string | null;
          demo_key?: string | null;
          detail?: string | null;
          event_type?: Database["public"]["Enums"]["execution_event_type"];
          id?: string;
          normalized_effect_metadata?: Json | null;
          receipt_metadata?: Json | null;
          result_status?: Database["public"]["Enums"]["execution_outcome"];
          summary?: string;
          task_id?: string;
          tenant_id?: string;
          tool_request_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "execution_events_capability_id_tenant_id_fkey";
            columns: ["capability_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "capabilities";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "execution_events_decision_id_tenant_id_fkey";
            columns: ["decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "authorization_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "execution_events_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "execution_events_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "execution_events_tool_request_id_tenant_id_fkey";
            columns: ["tool_request_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tool_requests";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      final_decisions: {
        Row: {
          authorization_decision_id: string;
          composition_reasons: string[];
          created_at: string;
          degraded: boolean;
          degraded_reason: string | null;
          deterministic_outcome: Database["public"]["Enums"]["authorization_outcome"];
          final_outcome: Database["public"]["Enums"]["authorization_outcome"];
          gateway_version: string;
          id: string;
          narrowed: boolean;
          risk_class: string;
          semantic_evaluation_id: string | null;
          semantic_mode: Database["public"]["Enums"]["semantic_mode"];
          semantic_policy: string;
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Insert: {
          authorization_decision_id: string;
          composition_reasons?: string[];
          created_at?: string;
          degraded?: boolean;
          degraded_reason?: string | null;
          deterministic_outcome: Database["public"]["Enums"]["authorization_outcome"];
          final_outcome: Database["public"]["Enums"]["authorization_outcome"];
          gateway_version: string;
          id?: string;
          narrowed: boolean;
          risk_class: string;
          semantic_evaluation_id?: string | null;
          semantic_mode: Database["public"]["Enums"]["semantic_mode"];
          semantic_policy: string;
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Update: {
          authorization_decision_id?: string;
          composition_reasons?: string[];
          created_at?: string;
          degraded?: boolean;
          degraded_reason?: string | null;
          deterministic_outcome?: Database["public"]["Enums"]["authorization_outcome"];
          final_outcome?: Database["public"]["Enums"]["authorization_outcome"];
          gateway_version?: string;
          id?: string;
          narrowed?: boolean;
          risk_class?: string;
          semantic_evaluation_id?: string | null;
          semantic_mode?: Database["public"]["Enums"]["semantic_mode"];
          semantic_policy?: string;
          task_id?: string;
          tenant_id?: string;
          tool_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "final_decisions_authorization_decision_id_tenant_id_fkey";
            columns: ["authorization_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "authorization_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "final_decisions_semantic_evaluation_id_tenant_id_fkey";
            columns: ["semantic_evaluation_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "semantic_evaluations";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "final_decisions_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "final_decisions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "final_decisions_tool_request_id_tenant_id_fkey";
            columns: ["tool_request_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tool_requests";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      github_execution_receipts: {
        Row: {
          after_sha: string | null;
          agent_id: string;
          authorization_decision_id: string;
          before_sha: string | null;
          capability_id: string;
          created_at: string;
          execution_id: string;
          execution_mode: string;
          finished_at: string;
          github_installation_id: number | null;
          github_request_id: string | null;
          http_status_class: number | null;
          id: string;
          installation_row_id: string | null;
          operation: string;
          reason_code: string | null;
          redaction_metadata: Json;
          repository_full_name: string | null;
          repository_id: string | null;
          request_hash: string;
          resource_ids: Json;
          result_category: string;
          started_at: string;
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Insert: {
          after_sha?: string | null;
          agent_id: string;
          authorization_decision_id: string;
          before_sha?: string | null;
          capability_id: string;
          created_at?: string;
          execution_id: string;
          execution_mode: string;
          finished_at: string;
          github_installation_id?: number | null;
          github_request_id?: string | null;
          http_status_class?: number | null;
          id?: string;
          installation_row_id?: string | null;
          operation: string;
          reason_code?: string | null;
          redaction_metadata?: Json;
          repository_full_name?: string | null;
          repository_id?: string | null;
          request_hash: string;
          resource_ids?: Json;
          result_category: string;
          started_at: string;
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Update: {
          after_sha?: string | null;
          agent_id?: string;
          authorization_decision_id?: string;
          before_sha?: string | null;
          capability_id?: string;
          created_at?: string;
          execution_id?: string;
          execution_mode?: string;
          finished_at?: string;
          github_installation_id?: number | null;
          github_request_id?: string | null;
          http_status_class?: number | null;
          id?: string;
          installation_row_id?: string | null;
          operation?: string;
          reason_code?: string | null;
          redaction_metadata?: Json;
          repository_full_name?: string | null;
          repository_id?: string | null;
          request_hash?: string;
          resource_ids?: Json;
          result_category?: string;
          started_at?: string;
          task_id?: string;
          tenant_id?: string;
          tool?: string;
        };
        Relationships: [
          {
            foreignKeyName: "github_execution_receipts_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_execution_receipts_authorization_decision_id_tenant_fkey";
            columns: ["authorization_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "authorization_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_execution_receipts_capability_id_tenant_id_fkey";
            columns: ["capability_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "capability_tokens";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_execution_receipts_installation_row_id_tenant_id_fkey";
            columns: ["installation_row_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "github_installations";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_execution_receipts_repository_id_tenant_id_fkey";
            columns: ["repository_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "github_repositories";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_execution_receipts_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_execution_receipts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      github_install_states: {
        Row: {
          completed_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          nonce_hash: string;
          principal_id: string;
          reject_reason: string | null;
          reported_installation_id: number | null;
          status: string;
          tenant_id: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          nonce_hash: string;
          principal_id: string;
          reject_reason?: string | null;
          reported_installation_id?: number | null;
          status?: string;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          nonce_hash?: string;
          principal_id?: string;
          reject_reason?: string | null;
          reported_installation_id?: number | null;
          status?: string;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "github_install_states_principal_id_tenant_id_fkey";
            columns: ["principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_install_states_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      github_installations: {
        Row: {
          account_login: string;
          account_type: string;
          connected_at: string;
          connected_by_principal_id: string | null;
          created_at: string;
          disconnected_at: string | null;
          disconnected_by_principal_id: string | null;
          github_account_id: number;
          github_installation_id: number;
          granted_permissions: Json;
          health_reasons: string[];
          id: string;
          last_verified_at: string | null;
          mode: string;
          repository_selection: string;
          status: string;
          subscribed_events: string[];
          suspended_at: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          account_login: string;
          account_type: string;
          connected_at?: string;
          connected_by_principal_id?: string | null;
          created_at?: string;
          disconnected_at?: string | null;
          disconnected_by_principal_id?: string | null;
          github_account_id: number;
          github_installation_id: number;
          granted_permissions?: Json;
          health_reasons?: string[];
          id?: string;
          last_verified_at?: string | null;
          mode: string;
          repository_selection: string;
          status?: string;
          subscribed_events?: string[];
          suspended_at?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          account_login?: string;
          account_type?: string;
          connected_at?: string;
          connected_by_principal_id?: string | null;
          created_at?: string;
          disconnected_at?: string | null;
          disconnected_by_principal_id?: string | null;
          github_account_id?: number;
          github_installation_id?: number;
          granted_permissions?: Json;
          health_reasons?: string[];
          id?: string;
          last_verified_at?: string | null;
          mode?: string;
          repository_selection?: string;
          status?: string;
          subscribed_events?: string[];
          suspended_at?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "github_installations_connected_by_principal_id_tenant_id_fkey";
            columns: ["connected_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_installations_disconnected_by_principal_id_tenant_i_fkey";
            columns: ["disconnected_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_installations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      github_repositories: {
        Row: {
          allowed: boolean;
          allowed_at: string | null;
          allowed_by_principal_id: string | null;
          archived: boolean;
          default_branch: string;
          discovered_at: string;
          full_name_lc: string | null;
          github_repository_id: number;
          id: string;
          installation_row_id: string;
          is_private: boolean;
          name: string;
          owner: string;
          present: boolean;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          allowed?: boolean;
          allowed_at?: string | null;
          allowed_by_principal_id?: string | null;
          archived?: boolean;
          default_branch: string;
          discovered_at?: string;
          full_name_lc?: string | null;
          github_repository_id: number;
          id?: string;
          installation_row_id: string;
          is_private: boolean;
          name: string;
          owner: string;
          present?: boolean;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          allowed?: boolean;
          allowed_at?: string | null;
          allowed_by_principal_id?: string | null;
          archived?: boolean;
          default_branch?: string;
          discovered_at?: string;
          full_name_lc?: string | null;
          github_repository_id?: number;
          id?: string;
          installation_row_id?: string;
          is_private?: boolean;
          name?: string;
          owner?: string;
          present?: boolean;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "github_repositories_allowed_by_principal_id_tenant_id_fkey";
            columns: ["allowed_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_repositories_installation_row_id_tenant_id_fkey";
            columns: ["installation_row_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "github_installations";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "github_repositories_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      github_webhook_deliveries: {
        Row: {
          action: string | null;
          delivery_id: string;
          event: string;
          github_installation_id: number | null;
          outcome: string;
          received_at: string;
        };
        Insert: {
          action?: string | null;
          delivery_id: string;
          event: string;
          github_installation_id?: number | null;
          outcome: string;
          received_at?: string;
        };
        Update: {
          action?: string | null;
          delivery_id?: string;
          event?: string;
          github_installation_id?: number | null;
          outcome?: string;
          received_at?: string;
        };
        Relationships: [];
      };
      integrations: {
        Row: {
          configured_scopes_metadata: Json | null;
          created_at: string;
          created_by: string | null;
          demo_key: string | null;
          display_name: string;
          health_metadata: Json | null;
          id: string;
          provider: Database["public"]["Enums"]["integration_provider"];
          status: Database["public"]["Enums"]["integration_status"];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          configured_scopes_metadata?: Json | null;
          created_at?: string;
          created_by?: string | null;
          demo_key?: string | null;
          display_name: string;
          health_metadata?: Json | null;
          id?: string;
          provider: Database["public"]["Enums"]["integration_provider"];
          status?: Database["public"]["Enums"]["integration_status"];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          configured_scopes_metadata?: Json | null;
          created_at?: string;
          created_by?: string | null;
          demo_key?: string | null;
          display_name?: string;
          health_metadata?: Json | null;
          id?: string;
          provider?: Database["public"]["Enums"]["integration_provider"];
          status?: Database["public"]["Enums"]["integration_status"];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "integrations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_nodes: {
        Row: {
          created_at: string;
          data_flow_refs: Json | null;
          declared_outputs: Json | null;
          demo_key: string | null;
          dependencies: string[];
          execution_order: number | null;
          expected_effect: string | null;
          id: string;
          max_invocations: number | null;
          node_key: string;
          normalized_arguments: Json;
          operation: string;
          plan_id: string;
          rationale: string | null;
          resource: string | null;
          sequence_no: number;
          status: Database["public"]["Enums"]["plan_node_status"];
          tenant_id: string;
          tool: string;
          validation_status: Database["public"]["Enums"]["plan_node_validation_status"] | null;
        };
        Insert: {
          created_at?: string;
          data_flow_refs?: Json | null;
          declared_outputs?: Json | null;
          demo_key?: string | null;
          dependencies?: string[];
          execution_order?: number | null;
          expected_effect?: string | null;
          id?: string;
          max_invocations?: number | null;
          node_key: string;
          normalized_arguments?: Json;
          operation: string;
          plan_id: string;
          rationale?: string | null;
          resource?: string | null;
          sequence_no: number;
          status?: Database["public"]["Enums"]["plan_node_status"];
          tenant_id: string;
          tool: string;
          validation_status?: Database["public"]["Enums"]["plan_node_validation_status"] | null;
        };
        Update: {
          created_at?: string;
          data_flow_refs?: Json | null;
          declared_outputs?: Json | null;
          demo_key?: string | null;
          dependencies?: string[];
          execution_order?: number | null;
          expected_effect?: string | null;
          id?: string;
          max_invocations?: number | null;
          node_key?: string;
          normalized_arguments?: Json;
          operation?: string;
          plan_id?: string;
          rationale?: string | null;
          resource?: string | null;
          sequence_no?: number;
          status?: Database["public"]["Enums"]["plan_node_status"];
          tenant_id?: string;
          tool?: string;
          validation_status?: Database["public"]["Enums"]["plan_node_validation_status"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_nodes_plan_id_tenant_id_fkey";
            columns: ["plan_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "plan_nodes_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          created_at: string;
          demo_key: string | null;
          id: string;
          idempotency_key: string | null;
          input_hash: string | null;
          model_metadata: Json | null;
          proposed_at: string;
          status: Database["public"]["Enums"]["plan_status"];
          submitted_by: string | null;
          task_id: string;
          tenant_id: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          demo_key?: string | null;
          id?: string;
          idempotency_key?: string | null;
          input_hash?: string | null;
          model_metadata?: Json | null;
          proposed_at?: string;
          status?: Database["public"]["Enums"]["plan_status"];
          submitted_by?: string | null;
          task_id: string;
          tenant_id: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          demo_key?: string | null;
          id?: string;
          idempotency_key?: string | null;
          input_hash?: string | null;
          model_metadata?: Json | null;
          proposed_at?: string;
          status?: Database["public"]["Enums"]["plan_status"];
          submitted_by?: string | null;
          task_id?: string;
          tenant_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "plans_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "plans_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      policies: {
        Row: {
          activated_at: string | null;
          conditions: Json;
          created_at: string;
          created_by: string | null;
          demo_key: string | null;
          description: string | null;
          effect: Database["public"]["Enums"]["policy_effect"];
          id: string;
          name: string;
          required_approval_count: number | null;
          required_approval_role: Database["public"]["Enums"]["tenant_role"] | null;
          status: Database["public"]["Enums"]["policy_status"];
          tenant_id: string;
          version: number;
        };
        Insert: {
          activated_at?: string | null;
          conditions?: Json;
          created_at?: string;
          created_by?: string | null;
          demo_key?: string | null;
          description?: string | null;
          effect: Database["public"]["Enums"]["policy_effect"];
          id?: string;
          name: string;
          required_approval_count?: number | null;
          required_approval_role?: Database["public"]["Enums"]["tenant_role"] | null;
          status?: Database["public"]["Enums"]["policy_status"];
          tenant_id: string;
          version?: number;
        };
        Update: {
          activated_at?: string | null;
          conditions?: Json;
          created_at?: string;
          created_by?: string | null;
          demo_key?: string | null;
          description?: string | null;
          effect?: Database["public"]["Enums"]["policy_effect"];
          id?: string;
          name?: string;
          required_approval_count?: number | null;
          required_approval_role?: Database["public"]["Enums"]["tenant_role"] | null;
          status?: Database["public"]["Enums"]["policy_status"];
          tenant_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "policies_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      principals: {
        Row: {
          created_at: string;
          demo_key: string | null;
          display_name: string;
          email: string | null;
          id: string;
          kind: Database["public"]["Enums"]["principal_kind"];
          tenant_id: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          demo_key?: string | null;
          display_name: string;
          email?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["principal_kind"];
          tenant_id: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          demo_key?: string | null;
          display_name?: string;
          email?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["principal_kind"];
          tenant_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "principals_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      runtime_approval_decisions: {
        Row: {
          approver_principal_id: string;
          created_at: string;
          decision: string;
          id: string;
          note: string | null;
          request_id: string;
          tenant_id: string;
        };
        Insert: {
          approver_principal_id: string;
          created_at?: string;
          decision: string;
          id?: string;
          note?: string | null;
          request_id: string;
          tenant_id: string;
        };
        Update: {
          approver_principal_id?: string;
          created_at?: string;
          decision?: string;
          id?: string;
          note?: string | null;
          request_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "runtime_approval_decisions_approver_principal_id_tenant_id_fkey";
            columns: ["approver_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "runtime_approval_decisions_request_id_tenant_id_fkey";
            columns: ["request_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "runtime_approval_requests";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "runtime_approval_decisions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      runtime_approval_requests: {
        Row: {
          agent_id: string;
          arguments_hash: string;
          authorization_decision_id: string;
          context_hash: string;
          contract_id: string;
          contract_version: number;
          created_at: string;
          evidence: Json;
          expires_at: string;
          final_decision_id: string;
          id: string;
          minted_capability_id: string | null;
          operation: string;
          request_hash: string;
          required_approvals: number;
          resolved_at: string | null;
          resource: string | null;
          risk_class: string;
          stale_reason: string | null;
          status: string;
          task_id: string;
          tenant_id: string;
          tool: string;
          tool_request_id: string;
          trigger_kind: string;
        };
        Insert: {
          agent_id: string;
          arguments_hash: string;
          authorization_decision_id: string;
          context_hash: string;
          contract_id: string;
          contract_version: number;
          created_at?: string;
          evidence: Json;
          expires_at: string;
          final_decision_id: string;
          id?: string;
          minted_capability_id?: string | null;
          operation: string;
          request_hash: string;
          required_approvals: number;
          resolved_at?: string | null;
          resource?: string | null;
          risk_class: string;
          stale_reason?: string | null;
          status?: string;
          task_id: string;
          tenant_id: string;
          tool: string;
          tool_request_id: string;
          trigger_kind: string;
        };
        Update: {
          agent_id?: string;
          arguments_hash?: string;
          authorization_decision_id?: string;
          context_hash?: string;
          contract_id?: string;
          contract_version?: number;
          created_at?: string;
          evidence?: Json;
          expires_at?: string;
          final_decision_id?: string;
          id?: string;
          minted_capability_id?: string | null;
          operation?: string;
          request_hash?: string;
          required_approvals?: number;
          resolved_at?: string | null;
          resource?: string | null;
          risk_class?: string;
          stale_reason?: string | null;
          status?: string;
          task_id?: string;
          tenant_id?: string;
          tool?: string;
          tool_request_id?: string;
          trigger_kind?: string;
        };
        Relationships: [
          {
            foreignKeyName: "runtime_approval_minted_fk";
            columns: ["minted_capability_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "capability_tokens";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "runtime_approval_requests_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "runtime_approval_requests_authorization_decision_id_tenant_fkey";
            columns: ["authorization_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "authorization_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "runtime_approval_requests_contract_id_tenant_id_fkey";
            columns: ["contract_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "task_authority_contracts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "runtime_approval_requests_final_decision_id_tenant_id_fkey";
            columns: ["final_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "final_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "runtime_approval_requests_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "runtime_approval_requests_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "runtime_approval_requests_tool_request_id_tenant_id_fkey";
            columns: ["tool_request_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tool_requests";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      semantic_decisions: {
        Row: {
          confidence: number;
          demo_key: string | null;
          error_category: string | null;
          error_message: string | null;
          evaluated_at: string;
          id: string;
          latency_ms: number;
          model: string;
          model_version: string;
          probabilities: Json;
          provider: string;
          state: Database["public"]["Enums"]["semantic_decision_state"];
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Insert: {
          confidence: number;
          demo_key?: string | null;
          error_category?: string | null;
          error_message?: string | null;
          evaluated_at?: string;
          id?: string;
          latency_ms: number;
          model: string;
          model_version: string;
          probabilities: Json;
          provider: string;
          state: Database["public"]["Enums"]["semantic_decision_state"];
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Update: {
          confidence?: number;
          demo_key?: string | null;
          error_category?: string | null;
          error_message?: string | null;
          evaluated_at?: string;
          id?: string;
          latency_ms?: number;
          model?: string;
          model_version?: string;
          probabilities?: Json;
          provider?: string;
          state?: Database["public"]["Enums"]["semantic_decision_state"];
          task_id?: string;
          tenant_id?: string;
          tool_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "semantic_decisions_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "semantic_decisions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "semantic_decisions_tool_request_id_tenant_id_fkey";
            columns: ["tool_request_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tool_requests";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      semantic_evaluations: {
        Row: {
          agent_id: string;
          attestation: string;
          authorization_decision_id: string;
          confidence: number;
          created_at: string;
          enforcement_grade: boolean;
          error_category: string | null;
          evidence_schema_version: number;
          id: string;
          indicators: string[];
          input_hash: string;
          latency_ms: number;
          mode: Database["public"]["Enums"]["semantic_mode"];
          model: string;
          model_version: string;
          provider: string;
          redaction_summary: Json;
          risk_level: Database["public"]["Enums"]["semantic_risk_level"];
          signals: Json | null;
          state: Database["public"]["Enums"]["semantic_evidence_state"];
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Insert: {
          agent_id: string;
          attestation?: string;
          authorization_decision_id: string;
          confidence: number;
          created_at?: string;
          enforcement_grade: boolean;
          error_category?: string | null;
          evidence_schema_version?: number;
          id?: string;
          indicators?: string[];
          input_hash: string;
          latency_ms: number;
          mode: Database["public"]["Enums"]["semantic_mode"];
          model: string;
          model_version: string;
          provider: string;
          redaction_summary?: Json;
          risk_level: Database["public"]["Enums"]["semantic_risk_level"];
          signals?: Json | null;
          state: Database["public"]["Enums"]["semantic_evidence_state"];
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Update: {
          agent_id?: string;
          attestation?: string;
          authorization_decision_id?: string;
          confidence?: number;
          created_at?: string;
          enforcement_grade?: boolean;
          error_category?: string | null;
          evidence_schema_version?: number;
          id?: string;
          indicators?: string[];
          input_hash?: string;
          latency_ms?: number;
          mode?: Database["public"]["Enums"]["semantic_mode"];
          model?: string;
          model_version?: string;
          provider?: string;
          redaction_summary?: Json;
          risk_level?: Database["public"]["Enums"]["semantic_risk_level"];
          signals?: Json | null;
          state?: Database["public"]["Enums"]["semantic_evidence_state"];
          task_id?: string;
          tenant_id?: string;
          tool_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "semantic_evaluations_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "semantic_evaluations_authorization_decision_id_tenant_id_fkey";
            columns: ["authorization_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "authorization_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "semantic_evaluations_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "semantic_evaluations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "semantic_evaluations_tool_request_id_tenant_id_fkey";
            columns: ["tool_request_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tool_requests";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      semantic_settings: {
        Row: {
          capability_ttl_seconds: number;
          enforcement_approved_at: string | null;
          enforcement_approved_by_principal_id: string | null;
          enforcement_approved_model: string | null;
          enforcement_approved_provider: string | null;
          mode: Database["public"]["Enums"]["semantic_mode"];
          model: string;
          provider: string;
          runtime_approval_classes: string[];
          semantic_required_classes: string[];
          tenant_id: string;
          timeout_ms: number;
          updated_at: string;
          updated_by_principal_id: string | null;
        };
        Insert: {
          capability_ttl_seconds?: number;
          enforcement_approved_at?: string | null;
          enforcement_approved_by_principal_id?: string | null;
          enforcement_approved_model?: string | null;
          enforcement_approved_provider?: string | null;
          mode?: Database["public"]["Enums"]["semantic_mode"];
          model?: string;
          provider?: string;
          runtime_approval_classes?: string[];
          semantic_required_classes?: string[];
          tenant_id: string;
          timeout_ms?: number;
          updated_at?: string;
          updated_by_principal_id?: string | null;
        };
        Update: {
          capability_ttl_seconds?: number;
          enforcement_approved_at?: string | null;
          enforcement_approved_by_principal_id?: string | null;
          enforcement_approved_model?: string | null;
          enforcement_approved_provider?: string | null;
          mode?: Database["public"]["Enums"]["semantic_mode"];
          model?: string;
          provider?: string;
          runtime_approval_classes?: string[];
          semantic_required_classes?: string[];
          tenant_id?: string;
          timeout_ms?: number;
          updated_at?: string;
          updated_by_principal_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "semantic_settings_approver_fk";
            columns: ["enforcement_approved_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "semantic_settings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "semantic_settings_updated_by_principal_id_tenant_id_fkey";
            columns: ["updated_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      semantic_settings_audit: {
        Row: {
          actor_principal_id: string | null;
          created_at: string;
          id: string;
          new_settings: Json;
          previous_settings: Json | null;
          tenant_id: string;
        };
        Insert: {
          actor_principal_id?: string | null;
          created_at?: string;
          id?: string;
          new_settings: Json;
          previous_settings?: Json | null;
          tenant_id: string;
        };
        Update: {
          actor_principal_id?: string | null;
          created_at?: string;
          id?: string;
          new_settings?: Json;
          previous_settings?: Json | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "semantic_settings_audit_actor_principal_id_tenant_id_fkey";
            columns: ["actor_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "semantic_settings_audit_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      semantic_shadow_evaluations: {
        Row: {
          agent_id: string;
          attestation: string;
          authoritative: boolean;
          authorization_decision_id: string;
          confidence: number;
          created_at: string;
          disagreement: Database["public"]["Enums"]["semantic_disagreement"];
          error_category: string | null;
          evidence_schema_version: number;
          id: string;
          indicators: string[];
          input_hash: string;
          latency_ms: number;
          mode: Database["public"]["Enums"]["semantic_mode"];
          model: string;
          model_version: string;
          provider: string;
          redaction_summary: Json;
          risk_level: Database["public"]["Enums"]["semantic_risk_level"];
          signals: Json | null;
          state: Database["public"]["Enums"]["semantic_evidence_state"];
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Insert: {
          agent_id: string;
          attestation?: string;
          authoritative?: boolean;
          authorization_decision_id: string;
          confidence: number;
          created_at?: string;
          disagreement?: Database["public"]["Enums"]["semantic_disagreement"];
          error_category?: string | null;
          evidence_schema_version?: number;
          id?: string;
          indicators?: string[];
          input_hash: string;
          latency_ms: number;
          mode?: Database["public"]["Enums"]["semantic_mode"];
          model: string;
          model_version: string;
          provider: string;
          redaction_summary?: Json;
          risk_level: Database["public"]["Enums"]["semantic_risk_level"];
          signals?: Json | null;
          state: Database["public"]["Enums"]["semantic_evidence_state"];
          task_id: string;
          tenant_id: string;
          tool_request_id: string;
        };
        Update: {
          agent_id?: string;
          attestation?: string;
          authoritative?: boolean;
          authorization_decision_id?: string;
          confidence?: number;
          created_at?: string;
          disagreement?: Database["public"]["Enums"]["semantic_disagreement"];
          error_category?: string | null;
          evidence_schema_version?: number;
          id?: string;
          indicators?: string[];
          input_hash?: string;
          latency_ms?: number;
          mode?: Database["public"]["Enums"]["semantic_mode"];
          model?: string;
          model_version?: string;
          provider?: string;
          redaction_summary?: Json;
          risk_level?: Database["public"]["Enums"]["semantic_risk_level"];
          signals?: Json | null;
          state?: Database["public"]["Enums"]["semantic_evidence_state"];
          task_id?: string;
          tenant_id?: string;
          tool_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "semantic_shadow_evaluations_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "semantic_shadow_evaluations_authorization_decision_id_tena_fkey";
            columns: ["authorization_decision_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "authorization_decisions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "semantic_shadow_evaluations_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "semantic_shadow_evaluations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "semantic_shadow_evaluations_tool_request_id_tenant_id_fkey";
            columns: ["tool_request_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tool_requests";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      task_authority_contracts: {
        Row: {
          activated_at: string | null;
          activated_by_principal_id: string | null;
          allowed_actions: Json;
          compiler_version: string | null;
          contract_status: Database["public"]["Enums"]["contract_status"];
          created_at: string;
          created_by: string | null;
          data_flow_bindings: Json | null;
          demo_key: string | null;
          ephemeral_limits: Json;
          expires_at: string | null;
          forbidden_operations: string[];
          forbidden_resources: string[];
          id: string;
          input_hash: string | null;
          output_hash: string | null;
          plan_id: string | null;
          registry_version: string | null;
          rejected_at: string | null;
          rejected_by_principal_id: string | null;
          rejection_reason: string | null;
          required_approvals: Json | null;
          required_approvals_spec: Json | null;
          revocation_reason: string | null;
          revoked_at: string | null;
          revoked_by_principal_id: string | null;
          source_evidence_metadata: Json;
          spec_version: string;
          submitted_at: string | null;
          submitted_by_principal_id: string | null;
          superseded_at: string | null;
          superseded_by_contract_id: string | null;
          task_id: string;
          tenant_id: string;
          version: number;
        };
        Insert: {
          activated_at?: string | null;
          activated_by_principal_id?: string | null;
          allowed_actions: Json;
          compiler_version?: string | null;
          contract_status?: Database["public"]["Enums"]["contract_status"];
          created_at?: string;
          created_by?: string | null;
          data_flow_bindings?: Json | null;
          demo_key?: string | null;
          ephemeral_limits: Json;
          expires_at?: string | null;
          forbidden_operations?: string[];
          forbidden_resources?: string[];
          id?: string;
          input_hash?: string | null;
          output_hash?: string | null;
          plan_id?: string | null;
          registry_version?: string | null;
          rejected_at?: string | null;
          rejected_by_principal_id?: string | null;
          rejection_reason?: string | null;
          required_approvals?: Json | null;
          required_approvals_spec?: Json | null;
          revocation_reason?: string | null;
          revoked_at?: string | null;
          revoked_by_principal_id?: string | null;
          source_evidence_metadata?: Json;
          spec_version: string;
          submitted_at?: string | null;
          submitted_by_principal_id?: string | null;
          superseded_at?: string | null;
          superseded_by_contract_id?: string | null;
          task_id: string;
          tenant_id: string;
          version?: number;
        };
        Update: {
          activated_at?: string | null;
          activated_by_principal_id?: string | null;
          allowed_actions?: Json;
          compiler_version?: string | null;
          contract_status?: Database["public"]["Enums"]["contract_status"];
          created_at?: string;
          created_by?: string | null;
          data_flow_bindings?: Json | null;
          demo_key?: string | null;
          ephemeral_limits?: Json;
          expires_at?: string | null;
          forbidden_operations?: string[];
          forbidden_resources?: string[];
          id?: string;
          input_hash?: string | null;
          output_hash?: string | null;
          plan_id?: string | null;
          registry_version?: string | null;
          rejected_at?: string | null;
          rejected_by_principal_id?: string | null;
          rejection_reason?: string | null;
          required_approvals?: Json | null;
          required_approvals_spec?: Json | null;
          revocation_reason?: string | null;
          revoked_at?: string | null;
          revoked_by_principal_id?: string | null;
          source_evidence_metadata?: Json;
          spec_version?: string;
          submitted_at?: string | null;
          submitted_by_principal_id?: string | null;
          superseded_at?: string | null;
          superseded_by_contract_id?: string | null;
          task_id?: string;
          tenant_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "tac_activated_by_principal_fk";
            columns: ["activated_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tac_plan_fk";
            columns: ["plan_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tac_rejected_by_principal_fk";
            columns: ["rejected_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tac_revoked_by_principal_fk";
            columns: ["revoked_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tac_submitted_by_principal_fk";
            columns: ["submitted_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tac_superseded_by_contract_fk";
            columns: ["superseded_by_contract_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "task_authority_contracts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "task_authority_contracts_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "task_authority_contracts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      task_repository_bindings: {
        Row: {
          bound_by_principal_id: string;
          created_at: string;
          id: string;
          repository_id: string;
          task_id: string;
          tenant_id: string;
        };
        Insert: {
          bound_by_principal_id: string;
          created_at?: string;
          id?: string;
          repository_id: string;
          task_id: string;
          tenant_id: string;
        };
        Update: {
          bound_by_principal_id?: string;
          created_at?: string;
          id?: string;
          repository_id?: string;
          task_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_repository_bindings_bound_by_principal_id_tenant_id_fkey";
            columns: ["bound_by_principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "task_repository_bindings_repository_id_tenant_id_fkey";
            columns: ["repository_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "github_repositories";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "task_repository_bindings_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "task_repository_bindings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          agent_id: string;
          completed_at: string | null;
          created_at: string;
          demo_key: string | null;
          id: string;
          idempotency_key: string | null;
          initiating_user_id: string | null;
          intent: string;
          principal_id: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["task_status"];
          tenant_id: string;
          terminated_at: string | null;
          trusted_context_provenance: Json;
          updated_at: string;
        };
        Insert: {
          agent_id: string;
          completed_at?: string | null;
          created_at?: string;
          demo_key?: string | null;
          id?: string;
          idempotency_key?: string | null;
          initiating_user_id?: string | null;
          intent: string;
          principal_id: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          tenant_id: string;
          terminated_at?: string | null;
          trusted_context_provenance?: Json;
          updated_at?: string;
        };
        Update: {
          agent_id?: string;
          completed_at?: string | null;
          created_at?: string;
          demo_key?: string | null;
          id?: string;
          idempotency_key?: string | null;
          initiating_user_id?: string | null;
          intent?: string;
          principal_id?: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          tenant_id?: string;
          terminated_at?: string | null;
          trusted_context_provenance?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tasks_principal_id_tenant_id_fkey";
            columns: ["principal_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "principals";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_memberships: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["tenant_role"];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          role: Database["public"]["Enums"]["tenant_role"];
          tenant_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["tenant_role"];
          tenant_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          created_by: string;
          environment: Database["public"]["Enums"]["tenant_environment"];
          id: string;
          name: string;
          slug: string;
          updated_at: string;
          validation_expires_at: string | null;
          validation_owner_tenant_id: string | null;
          validation_sandbox: boolean;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          environment?: Database["public"]["Enums"]["tenant_environment"];
          id?: string;
          name: string;
          slug: string;
          updated_at?: string;
          validation_expires_at?: string | null;
          validation_owner_tenant_id?: string | null;
          validation_sandbox?: boolean;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          environment?: Database["public"]["Enums"]["tenant_environment"];
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
          validation_expires_at?: string | null;
          validation_owner_tenant_id?: string | null;
          validation_sandbox?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "tenants_validation_owner_tenant_id_fkey";
            columns: ["validation_owner_tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tool_requests: {
        Row: {
          agent_id: string;
          argument_audit: Json | null;
          arguments_hash: string | null;
          arguments_redacted: boolean;
          demo_key: string | null;
          destination_metadata: Json | null;
          expected_effect: string | null;
          id: string;
          idempotency_key: string;
          normalized_arguments: Json;
          operation: string;
          plan_id: string | null;
          plan_node_id: string | null;
          provenance: string;
          request_hash: string | null;
          requested_at: string;
          resource: string | null;
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Insert: {
          agent_id: string;
          argument_audit?: Json | null;
          arguments_hash?: string | null;
          arguments_redacted?: boolean;
          demo_key?: string | null;
          destination_metadata?: Json | null;
          expected_effect?: string | null;
          id?: string;
          idempotency_key: string;
          normalized_arguments?: Json;
          operation: string;
          plan_id?: string | null;
          plan_node_id?: string | null;
          provenance?: string;
          request_hash?: string | null;
          requested_at?: string;
          resource?: string | null;
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Update: {
          agent_id?: string;
          argument_audit?: Json | null;
          arguments_hash?: string | null;
          arguments_redacted?: boolean;
          demo_key?: string | null;
          destination_metadata?: Json | null;
          expected_effect?: string | null;
          id?: string;
          idempotency_key?: string;
          normalized_arguments?: Json;
          operation?: string;
          plan_id?: string | null;
          plan_node_id?: string | null;
          provenance?: string;
          request_hash?: string | null;
          requested_at?: string;
          resource?: string | null;
          task_id?: string;
          tenant_id?: string;
          tool?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tool_requests_agent_id_tenant_id_fkey";
            columns: ["agent_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tool_requests_plan_id_tenant_id_fkey";
            columns: ["plan_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tool_requests_plan_node_id_tenant_id_fkey";
            columns: ["plan_node_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "plan_nodes";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tool_requests_task_id_tenant_id_fkey";
            columns: ["task_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tool_requests_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      validation_campaigns: {
        Row: {
          cancel_requested: boolean;
          config: Json;
          created_at: string;
          created_by: string | null;
          environment_id: string;
          finished_at: string | null;
          id: string;
          name: string;
          pack_key: string | null;
          progress: Json;
          seed: number;
          started_at: string | null;
          status: string;
          summary: Json | null;
          synthetic: boolean;
          tenant_id: string;
        };
        Insert: {
          cancel_requested?: boolean;
          config: Json;
          created_at?: string;
          created_by?: string | null;
          environment_id: string;
          finished_at?: string | null;
          id?: string;
          name: string;
          pack_key?: string | null;
          progress?: Json;
          seed: number;
          started_at?: string | null;
          status?: string;
          summary?: Json | null;
          synthetic?: boolean;
          tenant_id: string;
        };
        Update: {
          cancel_requested?: boolean;
          config?: Json;
          created_at?: string;
          created_by?: string | null;
          environment_id?: string;
          finished_at?: string | null;
          id?: string;
          name?: string;
          pack_key?: string | null;
          progress?: Json;
          seed?: number;
          started_at?: string | null;
          status?: string;
          summary?: Json | null;
          synthetic?: boolean;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "validation_campaigns_environment_id_tenant_id_fkey";
            columns: ["environment_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "validation_environments";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "validation_campaigns_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      validation_environments: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          expires_at: string;
          id: string;
          name: string;
          spec: Json;
          status: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expires_at: string;
          id?: string;
          name: string;
          spec: Json;
          status?: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expires_at?: string;
          id?: string;
          name?: string;
          spec?: Json;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "validation_environments_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      validation_findings: {
        Row: {
          campaign_id: string;
          category: string;
          cause: string;
          created_at: string;
          evidence: Json;
          id: string;
          run_id: string;
          scenario_key: string;
          severity: string;
          status: string;
          step_id: string | null;
          summary: string;
          tenant_id: string;
          title: string;
        };
        Insert: {
          campaign_id: string;
          category: string;
          cause: string;
          created_at?: string;
          evidence?: Json;
          id?: string;
          run_id: string;
          scenario_key: string;
          severity: string;
          status?: string;
          step_id?: string | null;
          summary: string;
          tenant_id: string;
          title: string;
        };
        Update: {
          campaign_id?: string;
          category?: string;
          cause?: string;
          created_at?: string;
          evidence?: Json;
          id?: string;
          run_id?: string;
          scenario_key?: string;
          severity?: string;
          status?: string;
          step_id?: string | null;
          summary?: string;
          tenant_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "validation_findings_campaign_id_tenant_id_fkey";
            columns: ["campaign_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "validation_campaigns";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "validation_findings_run_id_tenant_id_fkey";
            columns: ["run_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "validation_runs";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "validation_findings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      validation_regressions: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          last_run_at: string | null;
          last_run_id: string | null;
          last_status: string | null;
          origin_remediation_id: string | null;
          scenario_key: string;
          scenario_version_id: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          last_run_at?: string | null;
          last_run_id?: string | null;
          last_status?: string | null;
          origin_remediation_id?: string | null;
          scenario_key: string;
          scenario_version_id: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          last_run_at?: string | null;
          last_run_id?: string | null;
          last_status?: string | null;
          origin_remediation_id?: string | null;
          scenario_key?: string;
          scenario_version_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "validation_regressions_scenario_version_id_tenant_id_fkey";
            columns: ["scenario_version_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "validation_scenario_versions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "validation_regressions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      validation_remediations: {
        Row: {
          after_run_id: string | null;
          before_run_id: string | null;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          finding_id: string;
          id: string;
          kind: string;
          proposal: Json;
          regression_scenario_version_id: string | null;
          status: string;
          tenant_id: string;
          verification: Json | null;
        };
        Insert: {
          after_run_id?: string | null;
          before_run_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          finding_id: string;
          id?: string;
          kind: string;
          proposal: Json;
          regression_scenario_version_id?: string | null;
          status?: string;
          tenant_id: string;
          verification?: Json | null;
        };
        Update: {
          after_run_id?: string | null;
          before_run_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          finding_id?: string;
          id?: string;
          kind?: string;
          proposal?: Json;
          regression_scenario_version_id?: string | null;
          status?: string;
          tenant_id?: string;
          verification?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "validation_remediations_finding_id_tenant_id_fkey";
            columns: ["finding_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "validation_findings";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "validation_remediations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      validation_runs: {
        Row: {
          campaign_id: string;
          effects: Json | null;
          error_category: string | null;
          finished_at: string | null;
          id: string;
          metrics: Json | null;
          regression_id: string | null;
          repetition: number;
          sandbox_tenant_id: string | null;
          scenario_key: string;
          scenario_version: number;
          scenario_version_id: string;
          seed: number;
          started_at: string;
          status: string;
          tenant_id: string;
          variant: string;
          verdict: string | null;
        };
        Insert: {
          campaign_id: string;
          effects?: Json | null;
          error_category?: string | null;
          finished_at?: string | null;
          id?: string;
          metrics?: Json | null;
          regression_id?: string | null;
          repetition?: number;
          sandbox_tenant_id?: string | null;
          scenario_key: string;
          scenario_version: number;
          scenario_version_id: string;
          seed: number;
          started_at?: string;
          status?: string;
          tenant_id: string;
          variant?: string;
          verdict?: string | null;
        };
        Update: {
          campaign_id?: string;
          effects?: Json | null;
          error_category?: string | null;
          finished_at?: string | null;
          id?: string;
          metrics?: Json | null;
          regression_id?: string | null;
          repetition?: number;
          sandbox_tenant_id?: string | null;
          scenario_key?: string;
          scenario_version?: number;
          scenario_version_id?: string;
          seed?: number;
          started_at?: string;
          status?: string;
          tenant_id?: string;
          variant?: string;
          verdict?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "validation_runs_campaign_id_tenant_id_fkey";
            columns: ["campaign_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "validation_campaigns";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "validation_runs_regression_fk";
            columns: ["regression_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "validation_regressions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "validation_runs_scenario_version_id_tenant_id_fkey";
            columns: ["scenario_version_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "validation_scenario_versions";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "validation_runs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      validation_scenario_versions: {
        Row: {
          created_at: string;
          definition: Json;
          definition_hash: string;
          id: string;
          scenario_key: string;
          source: string;
          tenant_id: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          definition: Json;
          definition_hash: string;
          id?: string;
          scenario_key: string;
          source: string;
          tenant_id: string;
          version: number;
        };
        Update: {
          created_at?: string;
          definition?: Json;
          definition_hash?: string;
          id?: string;
          scenario_key?: string;
          source?: string;
          tenant_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "validation_scenario_versions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      validation_steps: {
        Row: {
          action: string;
          actual: Json | null;
          control: string | null;
          evidence: Json | null;
          expected: Json | null;
          id: string;
          kind: string;
          label: string;
          latency_ms: number | null;
          occurred_at: string;
          request: Json | null;
          run_id: string;
          seq: number;
          step_key: string;
          tenant_id: string;
          verdict: string;
        };
        Insert: {
          action: string;
          actual?: Json | null;
          control?: string | null;
          evidence?: Json | null;
          expected?: Json | null;
          id?: string;
          kind: string;
          label: string;
          latency_ms?: number | null;
          occurred_at?: string;
          request?: Json | null;
          run_id: string;
          seq: number;
          step_key: string;
          tenant_id: string;
          verdict: string;
        };
        Update: {
          action?: string;
          actual?: Json | null;
          control?: string | null;
          evidence?: Json | null;
          expected?: Json | null;
          id?: string;
          kind?: string;
          label?: string;
          latency_ms?: number | null;
          occurred_at?: string;
          request?: Json | null;
          run_id?: string;
          seq?: number;
          step_key?: string;
          tenant_id?: string;
          verdict?: string;
        };
        Relationships: [
          {
            foreignKeyName: "validation_steps_run_id_tenant_id_fkey";
            columns: ["run_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "validation_runs";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "validation_steps_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      activate_task_contract: {
        Args: { p_contract_id: string };
        Returns: undefined;
      };
      create_agent_credential: {
        Args: { p_agent_id: string };
        Returns: {
          credential_id: string;
          key_prefix: string;
          plaintext_secret: string;
        }[];
      };
      create_candidate_plan: {
        Args: {
          p_idempotency_key?: string;
          p_input_hash: string;
          p_nodes: Json;
          p_task_id: string;
        };
        Returns: {
          plan_id: string;
          version: number;
          was_created: boolean;
        }[];
      };
      create_task: {
        Args: {
          p_agent_id: string;
          p_idempotency_key?: string;
          p_principal_id: string;
          p_provenance?: string;
          p_tenant_id: string;
          p_trusted_objective: string;
        };
        Returns: {
          task_id: string;
          was_created: boolean;
        }[];
      };
      decide_contract_approval: {
        Args: {
          p_approval_id: string;
          p_decision: Database["public"]["Enums"]["approval_status"];
          p_reason?: string;
        };
        Returns: undefined;
      };
      decide_runtime_approval: {
        Args: { p_decision: string; p_note: string; p_request_id: string };
        Returns: string;
      };
      decide_validation_remediation: {
        Args: { p_decision: string; p_id: string; p_note: string };
        Returns: string;
      };
      ensure_onboarded: {
        Args: never;
        Returns: {
          tenant_id: string;
          was_created: boolean;
        }[];
      };
      get_semantic_evaluation_context: {
        Args: { p_credential_secret: string; p_decision_id: string };
        Returns: {
          ctx_allowed_tools: string[];
          ctx_arguments: Json;
          ctx_decision_outcome: Database["public"]["Enums"]["authorization_outcome"];
          ctx_existing_evaluation_id: string;
          ctx_mode: Database["public"]["Enums"]["semantic_mode"];
          ctx_model: string;
          ctx_operation: string;
          ctx_prior_calls: Json;
          ctx_provider: string;
          ctx_resource: string;
          ctx_task_intent: string;
          ctx_timeout_ms: number;
          ctx_tool: string;
        }[];
      };
      install_demo_workspace: {
        Args: { p_tenant_id: string };
        Returns: {
          was_installed: boolean;
        }[];
      };
      propose_task_contract: {
        Args: {
          p_allowed_actions: Json;
          p_compiler_version: string;
          p_data_flow_bindings: Json;
          p_ephemeral_limits: Json;
          p_forbidden_operations: string[];
          p_forbidden_resources: string[];
          p_input_hash: string;
          p_objective_trace: Json;
          p_output_hash: string;
          p_plan_id: string;
          p_registry_version: string;
          p_required_approvals: Json;
          p_required_approvals_spec: Json;
          p_task_id: string;
          p_verifier_result: Json;
        };
        Returns: {
          contract_id: string;
          version: number;
          was_created: boolean;
        }[];
      };
      reconcile_expired_contracts: { Args: never; Returns: number };
      record_agent_auth_failure: {
        Args: { p_credential_secret: string };
        Returns: undefined;
      };
      record_semantic_shadow: {
        Args: {
          p_confidence: number;
          p_credential_secret: string;
          p_decision_id: string;
          p_error_category: string;
          p_indicators: string[];
          p_input_hash: string;
          p_latency_ms: number;
          p_model: string;
          p_model_version: string;
          p_provider: string;
          p_redaction_summary: Json;
          p_risk_level: Database["public"]["Enums"]["semantic_risk_level"];
          p_signals: Json;
          p_state: Database["public"]["Enums"]["semantic_evidence_state"];
        };
        Returns: {
          rec_disagreement: Database["public"]["Enums"]["semantic_disagreement"];
          rec_evaluation_id: string;
          rec_replayed: boolean;
        }[];
      };
      reject_contract: {
        Args: { p_contract_id: string; p_reason: string };
        Returns: undefined;
      };
      reset_demo_workspace: {
        Args: { p_tenant_id: string };
        Returns: undefined;
      };
      revoke_agent_credential: {
        Args: { p_credential_id: string; p_reason: string };
        Returns: undefined;
      };
      revoke_capability: {
        Args: { p_capability_id: string; p_reason: string };
        Returns: undefined;
      };
      revoke_task_contract: {
        Args: { p_contract_id: string; p_reason: string };
        Returns: undefined;
      };
      set_runtime_approval_classes: {
        Args: { p_classes: string[]; p_tenant_id: string };
        Returns: undefined;
      };
      set_semantic_settings: {
        Args: {
          p_mode: Database["public"]["Enums"]["semantic_mode"];
          p_model: string;
          p_provider: string;
          p_tenant_id: string;
          p_timeout_ms: number;
        };
        Returns: undefined;
      };
      set_semantic_settings_v2: {
        Args: {
          p_approve_enforcement: boolean;
          p_capability_ttl_seconds: number;
          p_mode: Database["public"]["Enums"]["semantic_mode"];
          p_model: string;
          p_provider: string;
          p_required_classes: string[];
          p_tenant_id: string;
          p_timeout_ms: number;
        };
        Returns: undefined;
      };
      submit_contract_for_approval: {
        Args: { p_contract_id: string };
        Returns: undefined;
      };
      terminate_task: { Args: { p_task_id: string }; Returns: undefined };
    };
    Enums: {
      agent_auth_outcome: "success" | "invalid_credential" | "revoked_credential" | "rate_limited";
      agent_credential_status: "active" | "revoked";
      agent_risk_tier: "low" | "medium" | "high";
      agent_status: "active" | "paused" | "revoked";
      approval_requirement_kind: "task_owner" | "role";
      approval_status: "pending" | "approved" | "rejected" | "expired";
      authorization_outcome:
        "allow" | "allow_constrained" | "replan" | "clarify" | "require_approval" | "deny";
      capability_status: "active" | "expired" | "revoked" | "consumed";
      contract_status:
        | "draft"
        | "active"
        | "superseded"
        | "proposed"
        | "awaiting_approval"
        | "rejected"
        | "expired"
        | "revoked";
      execution_event_type:
        | "task_received"
        | "contract_issued"
        | "plan_proposed"
        | "request_evaluated"
        | "capability_issued"
        | "tool_invoked"
        | "tool_failed"
        | "approval_requested"
        | "approval_resolved"
        | "capability_revoked"
        | "task_completed"
        | "task_terminated";
      execution_outcome: "success" | "failure" | "blocked" | "info";
      integration_provider: "github" | "stripe" | "gmail" | "postgres" | "slack" | "salesforce";
      integration_status: "connected" | "warning" | "not_connected";
      plan_node_status: "proposed" | "allowed" | "rejected" | "executed" | "skipped";
      plan_node_validation_status:
        "pending" | "accepted" | "requires_review" | "clarify" | "replan" | "denied";
      plan_status: "proposed" | "superseded";
      policy_effect: "allow" | "deny" | "require_approval";
      policy_status: "draft" | "active" | "archived";
      principal_kind: "human" | "service";
      semantic_decision_state: "ok" | "timeout" | "error";
      semantic_disagreement: "none" | "semantic_flags_permitted" | "semantic_clears_denied";
      semantic_evidence_state: "ok" | "timeout" | "error" | "unavailable" | "circuit_open";
      semantic_mode: "off" | "shadow" | "enforce";
      semantic_risk_level: "low" | "medium" | "high" | "critical" | "unknown";
      task_status:
        | "pending"
        | "contract_issued"
        | "executing"
        | "awaiting_approval"
        | "completed"
        | "failed"
        | "terminated";
      tenant_environment: "development" | "staging" | "production";
      tenant_role: "viewer" | "developer" | "security_admin" | "admin" | "owner";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      agent_auth_outcome: ["success", "invalid_credential", "revoked_credential", "rate_limited"],
      agent_credential_status: ["active", "revoked"],
      agent_risk_tier: ["low", "medium", "high"],
      agent_status: ["active", "paused", "revoked"],
      approval_requirement_kind: ["task_owner", "role"],
      approval_status: ["pending", "approved", "rejected", "expired"],
      authorization_outcome: ["allow", "allow_constrained", "replan", "clarify", "require_approval", "deny"],
      capability_status: ["active", "expired", "revoked", "consumed"],
      contract_status: [
        "draft",
        "active",
        "superseded",
        "proposed",
        "awaiting_approval",
        "rejected",
        "expired",
        "revoked",
      ],
      execution_event_type: [
        "task_received",
        "contract_issued",
        "plan_proposed",
        "request_evaluated",
        "capability_issued",
        "tool_invoked",
        "tool_failed",
        "approval_requested",
        "approval_resolved",
        "capability_revoked",
        "task_completed",
        "task_terminated",
      ],
      execution_outcome: ["success", "failure", "blocked", "info"],
      integration_provider: ["github", "stripe", "gmail", "postgres", "slack", "salesforce"],
      integration_status: ["connected", "warning", "not_connected"],
      plan_node_status: ["proposed", "allowed", "rejected", "executed", "skipped"],
      plan_node_validation_status: ["pending", "accepted", "requires_review", "clarify", "replan", "denied"],
      plan_status: ["proposed", "superseded"],
      policy_effect: ["allow", "deny", "require_approval"],
      policy_status: ["draft", "active", "archived"],
      principal_kind: ["human", "service"],
      semantic_decision_state: ["ok", "timeout", "error"],
      semantic_disagreement: ["none", "semantic_flags_permitted", "semantic_clears_denied"],
      semantic_evidence_state: ["ok", "timeout", "error", "unavailable", "circuit_open"],
      semantic_mode: ["off", "shadow", "enforce"],
      semantic_risk_level: ["low", "medium", "high", "critical", "unknown"],
      task_status: [
        "pending",
        "contract_issued",
        "executing",
        "awaiting_approval",
        "completed",
        "failed",
        "terminated",
      ],
      tenant_environment: ["development", "staging", "production"],
      tenant_role: ["viewer", "developer", "security_admin", "admin", "owner"],
    },
  },
} as const;
