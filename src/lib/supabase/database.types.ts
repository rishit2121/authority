export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
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
          authorization_decision_id: string;
          created_at: string;
          decided_at: string | null;
          decision_reason: string | null;
          demo_key: string | null;
          id: string;
          requested_at: string;
          requested_authority_delta: Json | null;
          requested_by: string | null;
          requested_from_principal_id: string;
          responded_by_principal_id: string | null;
          status: Database["public"]["Enums"]["approval_status"];
          summary: string;
          task_id: string;
          tenant_id: string;
        };
        Insert: {
          assigned_approver_principal_id?: string | null;
          authorization_decision_id: string;
          created_at?: string;
          decided_at?: string | null;
          decision_reason?: string | null;
          demo_key?: string | null;
          id?: string;
          requested_at?: string;
          requested_authority_delta?: Json | null;
          requested_by?: string | null;
          requested_from_principal_id: string;
          responded_by_principal_id?: string | null;
          status?: Database["public"]["Enums"]["approval_status"];
          summary: string;
          task_id: string;
          tenant_id: string;
        };
        Update: {
          assigned_approver_principal_id?: string | null;
          authorization_decision_id?: string;
          created_at?: string;
          decided_at?: string | null;
          decision_reason?: string | null;
          demo_key?: string | null;
          id?: string;
          requested_at?: string;
          requested_authority_delta?: Json | null;
          requested_by?: string | null;
          requested_from_principal_id?: string;
          responded_by_principal_id?: string | null;
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
          contract_id: string;
          contract_version: number;
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
          contract_id: string;
          contract_version: number;
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
          contract_id?: string;
          contract_version?: number;
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
          demo_key: string | null;
          dependencies: string[];
          execution_order: number | null;
          expected_effect: string | null;
          id: string;
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
        };
        Insert: {
          created_at?: string;
          demo_key?: string | null;
          dependencies?: string[];
          execution_order?: number | null;
          expected_effect?: string | null;
          id?: string;
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
        };
        Update: {
          created_at?: string;
          demo_key?: string | null;
          dependencies?: string[];
          execution_order?: number | null;
          expected_effect?: string | null;
          id?: string;
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
      task_authority_contracts: {
        Row: {
          allowed_actions: Json;
          contract_status: Database["public"]["Enums"]["contract_status"];
          created_at: string;
          created_by: string | null;
          demo_key: string | null;
          ephemeral_limits: Json;
          forbidden_resources: string[];
          id: string;
          source_evidence_metadata: Json;
          spec_version: string;
          task_id: string;
          tenant_id: string;
          version: number;
        };
        Insert: {
          allowed_actions: Json;
          contract_status?: Database["public"]["Enums"]["contract_status"];
          created_at?: string;
          created_by?: string | null;
          demo_key?: string | null;
          ephemeral_limits: Json;
          forbidden_resources?: string[];
          id?: string;
          source_evidence_metadata?: Json;
          spec_version: string;
          task_id: string;
          tenant_id: string;
          version?: number;
        };
        Update: {
          allowed_actions?: Json;
          contract_status?: Database["public"]["Enums"]["contract_status"];
          created_at?: string;
          created_by?: string | null;
          demo_key?: string | null;
          ephemeral_limits?: Json;
          forbidden_resources?: string[];
          id?: string;
          source_evidence_metadata?: Json;
          spec_version?: string;
          task_id?: string;
          tenant_id?: string;
          version?: number;
        };
        Relationships: [
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
      tasks: {
        Row: {
          agent_id: string;
          completed_at: string | null;
          created_at: string;
          demo_key: string | null;
          id: string;
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
        };
        Insert: {
          created_at?: string;
          created_by: string;
          environment?: Database["public"]["Enums"]["tenant_environment"];
          id?: string;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          environment?: Database["public"]["Enums"]["tenant_environment"];
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tool_requests: {
        Row: {
          agent_id: string;
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
          requested_at: string;
          resource: string | null;
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Insert: {
          agent_id: string;
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
          requested_at?: string;
          resource?: string | null;
          task_id: string;
          tenant_id: string;
          tool: string;
        };
        Update: {
          agent_id?: string;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      ensure_onboarded: {
        Args: never;
        Returns: {
          tenant_id: string;
          was_created: boolean;
        }[];
      };
      install_demo_workspace: {
        Args: { p_tenant_id: string };
        Returns: {
          was_installed: boolean;
        }[];
      };
      reset_demo_workspace: {
        Args: { p_tenant_id: string };
        Returns: undefined;
      };
      terminate_task: { Args: { p_task_id: string }; Returns: undefined };
    };
    Enums: {
      agent_risk_tier: "low" | "medium" | "high";
      agent_status: "active" | "paused" | "revoked";
      approval_status: "pending" | "approved" | "rejected" | "expired";
      authorization_outcome:
        "allow" | "allow_constrained" | "replan" | "clarify" | "require_approval" | "deny";
      capability_status: "active" | "expired" | "revoked" | "consumed";
      contract_status: "draft" | "active" | "superseded";
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
      plan_status: "proposed" | "superseded";
      policy_effect: "allow" | "deny";
      policy_status: "draft" | "active" | "archived";
      principal_kind: "human" | "service";
      semantic_decision_state: "ok" | "timeout" | "error";
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
      agent_risk_tier: ["low", "medium", "high"],
      agent_status: ["active", "paused", "revoked"],
      approval_status: ["pending", "approved", "rejected", "expired"],
      authorization_outcome: ["allow", "allow_constrained", "replan", "clarify", "require_approval", "deny"],
      capability_status: ["active", "expired", "revoked", "consumed"],
      contract_status: ["draft", "active", "superseded"],
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
      plan_status: ["proposed", "superseded"],
      policy_effect: ["allow", "deny"],
      policy_status: ["draft", "active", "archived"],
      principal_kind: ["human", "service"],
      semantic_decision_state: ["ok", "timeout", "error"],
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
