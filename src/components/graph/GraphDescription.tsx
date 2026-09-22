import { ALL_SERVICE_NAMES, CAPABILITY_PATHS, TASK, UNAUTHORIZED_NODE } from "./graph-data";

/**
 * Textual equivalent of the graph for assistive technology.
 *
 * The SVG itself is `aria-hidden`, so this is the sole accessible
 * representation rather than a duplicate of one. It describes the resolved
 * outcome of the cycle, which stays true at every frame of the loop.
 */
export function GraphDescription() {
  return (
    <div id="authority-graph-description" className="sr-only">
      <h3>Authority graph: runtime authorization walkthrough</h3>
      <ol>
        <li>
          <strong>Task received.</strong> Trusted user task: “{TASK.prompt}.” The agent customer-ops-agent is
          connected to {ALL_SERVICE_NAMES.length} services: {ALL_SERVICE_NAMES.join(", ")}. Before
          authorization none of them carry task authority.
        </li>
        <li>
          <strong>Paths authorized.</strong> {CAPABILITY_PATHS.length} temporary capabilities are granted
          together: {CAPABILITY_PATHS.map((c) => c.tool).join(", ")}. GitHub and Salesforce receive no
          authority for this task and stay inactive.
        </li>
        <li>
          <strong>Resources constrained.</strong> Each capability terminates at a single resource:{" "}
          {CAPABILITY_PATHS.map((c) => `${c.tool} at ${c.terminatesAt}`).join("; ")}. Neighbouring database
          rows, payments and contacts remain visible but unreachable.
        </li>
        <li>
          <strong>Slack rejected.</strong> The agent proposed {UNAUTHORIZED_NODE.tool} on Slack.{" "}
          {UNAUTHORIZED_NODE.reason} The path fades out and no capability is issued.
        </li>
        <li>
          <strong>Task completed.</strong> All four authorized calls execute successfully and are recorded in
          the decision trace.
        </li>
        <li>
          <strong>Capabilities revoked.</strong> 4 capabilities revoked · 0 standing permissions remain.
        </li>
      </ol>
    </div>
  );
}
