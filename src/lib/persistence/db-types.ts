import type { Database } from "@/lib/supabase/database.types";

/** Shorthand for a generated row type — `Tables<"agents">` etc. */
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

/** Shorthand for a generated insert payload type. */
export type InsertRow<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

/** Shorthand for a generated update payload type. */
export type UpdateRow<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
