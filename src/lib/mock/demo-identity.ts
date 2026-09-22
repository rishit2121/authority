/**
 * The signed-in demo user and workspace shown in the sidebar.
 *
 * Part 1 has no authentication, so this is fixed rather than derived from a
 * session. `principalName` matches `prin_maya` in the GitHub #991 scenario;
 * `team` is presentational and not a modeled entity.
 */
export const DEMO_USER = {
  name: "Maya Okafor",
  team: "Platform Security",
  initials: "MO",
} as const;

export interface DemoWorkspace {
  id: string;
  name: string;
  environment: string;
}

export const DEMO_WORKSPACES: DemoWorkspace[] = [
  { id: "northwind", name: "Northwind Labs", environment: "Development" },
  { id: "sandbox", name: "Personal sandbox", environment: "Development" },
];

export const CURRENT_WORKSPACE = DEMO_WORKSPACES[0];
