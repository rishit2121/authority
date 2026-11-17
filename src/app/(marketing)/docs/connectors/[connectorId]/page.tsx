import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";
import { REST_CONNECTOR_SPECS } from "@/lib/connectors/rest/providers";
import { restConnectorSpecSchema } from "@/lib/connectors/rest/spec";

/** The guide for each declarative REST connector, generated from the same spec the connector executes. */

function specFor(connectorId: string) {
  const spec = REST_CONNECTOR_SPECS.find((s) => s.id === connectorId);
  return spec ? restConnectorSpecSchema.parse(spec) : null;
}

export function generateStaticParams() {
  return REST_CONNECTOR_SPECS.map((spec) => ({ connectorId: spec.id }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ connectorId: string }>;
}): Promise<Metadata> {
  const spec = specFor((await params).connectorId);
  return { title: spec ? `${spec.name} connector — Authority Docs` : "Connector — Authority Docs" };
}

const EFFECT = {
  read: "read",
  write_create: "create",
  write_update: "update",
  write_delete: "delete",
} as const;

export default async function RestConnectorDocsPage({
  params,
}: {
  params: Promise<{ connectorId: string }>;
}) {
  const spec = specFor((await params).connectorId);
  if (!spec) notFound();
  const host = spec.host.replace(/^\{config\.([a-z0-9_]+)\}\./, (_m, key: string) => {
    const label = spec.configFields.find((f) => f.key === key)?.label ?? key;
    return `<${label}>.`;
  });

  return (
    <DocsPage title={spec.name} description={`${spec.description} A fixed, audited set of operations.`}>
      <DocsSection title="Connection setup">
        <p>
          An admin connects at <code>/app/integrations/{spec.id}</code> with a{" "}
          {spec.credential.label.toLowerCase()}
          {spec.configFields.length > 0
            ? ` and ${spec.configFields.map((f) => f.label.toLowerCase()).join(", ")}`
            : ""}
          . Saving checks it immediately with one read against {spec.name}. {spec.credential.help}
        </p>
        <p>
          Calls go only to{" "}
          <code>
            https://{host}
            {spec.basePath}
          </code>
          . The credential is stored server-side (Vault-backed), sent only in the request&apos;s
          authentication, and never returned to a browser, an agent or a log.
        </p>
      </DocsSection>

      <DocsSection title="Supported operations">
        <DocsTable
          headers={["Operation", "Arguments", "Effect", "Notes"]}
          rows={spec.operations.map((op) => [
            <code key="t">
              {spec.id}.{op.slug}
            </code>,
            op.args.length === 0
              ? "—"
              : op.args
                  .map((a) => `${a.key}${a.required ? "" : "?"}${a.freeText ? " (agent-written)" : ""}`)
                  .join(", "),
            EFFECT[op.sideEffect],
            [
              op.summary,
              op.externalCommunication ? "Reaches people outside the organization." : "",
              op.financialImpact ? "Moves money." : "",
            ]
              .filter(Boolean)
              .join(" "),
          ])}
        />
        <p>
          Every argument that isn&apos;t marked agent-written must be pinned by the task&apos;s plan, so a
          task prepared for one record can&apos;t be pointed at another. An argument a task didn&apos;t
          declare is refused.
        </p>
      </DocsSection>

      <DocsSection title="Verification status">
        <p>
          Checked against {spec.name}&apos;s published API reference (
          <a href={spec.docsUrl} className="underline">
            {spec.docsUrl}
          </a>
          ) and, through Authority&apos;s own authorize and execute path, against a mock of it. It has not yet
          been run against a live {spec.name} account by the Authority team. If a call doesn&apos;t behave as
          documented, please open an issue.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
