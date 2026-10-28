"use client";

import { useState, useTransition } from "react";

import {
  createPostgresConnectionAction,
  createPostgresQueryAction,
  deletePostgresQueryDraftAction,
  disconnectPostgresConnectionAction,
  removePostgresConnectionAction,
  publishPostgresQueryAction,
  retirePostgresQueryAction,
  setPostgresCredentialsAction,
  validatePostgresQueryAction,
  type PostgresActionResult,
} from "./actions";
import type { ConnectionRow, QueryRow } from "./page";

const BTN =
  "rounded-lg border border-outline-variant/40 bg-surface-container-high px-space-md py-1.5 font-body-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface placeholder:text-outline";
const TEXTAREA = `${INPUT} w-full font-mono-code text-[12px]`;

function useAction() {
  const [result, setResult] = useState<PostgresActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<PostgresActionResult>) =>
    start(async () => {
      setResult(await fn());
    });
  return { result, pending, run };
}

function Result({ result }: { result: PostgresActionResult | null }) {
  if (!result) return null;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={`font-body-sm text-body-sm ${result.ok ? "text-allow" : "text-deny"}`}
    >
      {result.ok ? (result.message ?? "Done.") : result.error}
    </p>
  );
}

export function ConnectConnectionForm() {
  const { result, pending, run } = useAction();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [sslmode, setSslmode] = useState<"require" | "disable">("require");

  return (
    <section
      aria-labelledby="new-postgres-connection-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
    >
      <h2
        id="new-postgres-connection-heading"
        className="font-headline-sm text-headline-sm font-semibold text-on-surface"
      >
        New connection
      </h2>
      <form
        className="mt-space-sm flex flex-wrap items-end gap-space-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createPostgresConnectionAction({ name, host, port: Number(port), database, sslmode }));
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Primary database"
            className={INPUT}
            data-testid="postgres-name"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Host</span>
          <input
            required
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="db.internal.example.com"
            className={`${INPUT} w-56`}
            data-testid="postgres-host"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Port</span>
          <input
            required
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className={`${INPUT} w-20`}
            data-testid="postgres-port"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Database</span>
          <input
            required
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            className={INPUT}
            data-testid="postgres-database"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">SSL</span>
          <select
            value={sslmode}
            onChange={(e) => setSslmode(e.target.value as "require" | "disable")}
            className={INPUT}
          >
            <option value="require">require</option>
            <option value="disable">disable</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="postgres-connect">
          Connect
        </button>
      </form>
      <p className="mt-space-sm font-body-sm text-body-sm text-outline">
        The cloud metadata endpoint and loopback are always refused; private network addresses are allowed,
        since that is where a real database normally lives.
      </p>
      <Result result={result} />
    </section>
  );
}

function CredentialsForm({ connectionId }: { connectionId: string }) {
  const { result, pending, run } = useAction();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-space-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setPostgresCredentialsAction(connectionId, username, password));
        setPassword("");
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Username</span>
        <input
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={INPUT}
          autoComplete="off"
          data-testid="postgres-username"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Password</span>
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
          autoComplete="off"
          data-testid="postgres-password"
        />
      </label>
      <button type="submit" disabled={pending} className={BTN} data-testid="postgres-save-credentials">
        Save credentials
      </button>
      <Result result={result} />
    </form>
  );
}

const EFFECTS = ["read", "write_create", "write_update", "write_delete", "admin"] as const;
const FIELD_TYPES = ["string", "number", "boolean"] as const;

interface DraftField {
  key: string;
  type: (typeof FIELD_TYPES)[number];
  identifiesResource: boolean;
}

function NewQueryForm({ connectionId }: { connectionId: string }) {
  const { result, pending, run } = useAction();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [sqlTemplate, setSqlTemplate] = useState(
    "select id, status from orders where customer_id = :customerId",
  );
  const [effect, setEffect] = useState<(typeof EFFECTS)[number]>("read");
  const [fields, setFields] = useState<DraftField[]>([
    { key: "customerId", type: "string", identifiesResource: true },
  ]);

  const updateField = (index: number, next: DraftField) => {
    setFields((prev) => prev.map((f, i) => (i === index ? next : f)));
  };
  const removeField = (index: number) => setFields((prev) => prev.filter((_, i) => i !== index));

  return (
    <form
      className="flex flex-col gap-space-sm rounded-lg border border-dashed border-outline-variant/40 p-space-md"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          createPostgresQueryAction({
            connectionId,
            querySlug: slug,
            name,
            sqlTemplate,
            effect,
            fields: fields.map((f) => ({ ...f, required: true })),
          }),
        );
      }}
    >
      <p className="font-headline-sm text-body-sm font-semibold text-on-surface">New query (draft)</p>
      <div className="flex flex-wrap gap-space-sm">
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Slug</span>
          <input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="get_customer_orders"
            className={INPUT}
            data-testid="postgres-query-slug"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Get customer orders"
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Effect</span>
          <select
            value={effect}
            onChange={(e) => setEffect(e.target.value as (typeof EFFECTS)[number])}
            className={INPUT}
          >
            {EFFECTS.map((eff) => (
              <option key={eff}>{eff}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
          SQL (named parameters, e.g. :customerId)
        </span>
        <textarea
          required
          rows={3}
          value={sqlTemplate}
          onChange={(e) => setSqlTemplate(e.target.value)}
          className={TEXTAREA}
          data-testid="postgres-sql-template"
        />
      </label>
      <div className="flex flex-col gap-space-sm">
        {fields.map((field, i) => (
          <div
            key={i}
            className="flex flex-wrap items-end gap-space-sm rounded border border-outline-variant/20 p-space-sm"
            data-testid="postgres-field-row"
          >
            <label className="flex flex-col gap-1">
              <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Key</span>
              <input
                required
                value={field.key}
                onChange={(e) => updateField(i, { ...field, key: e.target.value })}
                className={INPUT}
                data-testid="postgres-field-key"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Type</span>
              <select
                value={field.type}
                onChange={(e) => updateField(i, { ...field, type: e.target.value as DraftField["type"] })}
                className={INPUT}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-1.5">
              <input
                type="checkbox"
                checked={field.identifiesResource}
                onChange={(e) => updateField(i, { ...field, identifiesResource: e.target.checked })}
                data-testid="postgres-field-identifies-resource"
              />
              <span className="font-body-sm text-body-sm text-on-surface-variant">Identifies resource</span>
            </label>
            {fields.length > 1 ? (
              <button type="button" className={BTN} onClick={() => removeField(i)}>
                Remove
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className={BTN}
          onClick={() =>
            setFields((prev) => [...prev, { key: "", type: "string", identifiesResource: false }])
          }
        >
          Add field
        </button>
        <p className="font-body-sm text-body-sm text-outline">
          Every field must appear as a &quot;:key&quot; placeholder in the SQL above and is always required —
          a native parameterized query has no way to skip a placeholder that is present.
        </p>
      </div>
      <div>
        <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="postgres-create-query">
          Create draft
        </button>
      </div>
      <Result result={result} />
    </form>
  );
}

function QueryRowView({
  query,
  canDevelop,
  canAdmin,
}: {
  query: QueryRow;
  canDevelop: boolean;
  canAdmin: boolean;
}) {
  const { result, pending, run } = useAction();
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-space-sm py-2.5"
      data-testid={`postgres-query-${query.querySlug}`}
    >
      <div>
        <span className="font-mono-code text-[13px] text-on-surface">{query.sqlTemplate}</span>
        <span className="ml-2 font-body-sm text-body-sm text-outline">
          {query.toolName} · {query.effect}
        </span>
      </div>
      <div className="flex items-center gap-space-sm">
        <span
          className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${
            query.status === "published"
              ? "border-allow/30 bg-allow/10 text-allow"
              : query.status === "retired"
                ? "border-outline-variant/40 bg-surface-container-high text-on-surface-variant"
                : "border-secondary/40 bg-secondary/10 text-secondary"
          }`}
        >
          {query.status}
        </span>
        {query.status === "draft" && canDevelop ? (
          <>
            <button
              disabled={pending}
              className={BTN}
              onClick={() => run(() => validatePostgresQueryAction(query.id))}
            >
              Validate
            </button>
            <button
              disabled={pending}
              className={BTN}
              onClick={() => run(() => deletePostgresQueryDraftAction(query.id))}
            >
              Delete
            </button>
          </>
        ) : null}
        {query.status === "validated" && canAdmin ? (
          <button
            disabled={pending}
            className={BTN_PRIMARY}
            data-testid={`postgres-publish-${query.querySlug}`}
            onClick={() => run(() => publishPostgresQueryAction(query.id))}
          >
            Publish
          </button>
        ) : null}
        {query.status === "published" && canAdmin ? (
          <button
            disabled={pending}
            className={BTN}
            onClick={() => run(() => retirePostgresQueryAction(query.id))}
          >
            Retire
          </button>
        ) : null}
      </div>
      <Result result={result} />
    </li>
  );
}

export function ConnectionCard({
  connection,
  statusStyle,
  canAdmin,
  canDevelop,
}: {
  connection: ConnectionRow;
  statusStyle: string;
  canAdmin: boolean;
  canDevelop: boolean;
}) {
  const { result, pending, run } = useAction();
  return (
    <section
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      data-testid={`postgres-connection-${connection.connectorId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">{connection.name}</h2>
        <div className="flex items-center gap-space-sm">
          <span className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${statusStyle}`}>
            {connection.status}
          </span>
          {canAdmin && connection.status !== "disconnected" ? (
            <button
              disabled={pending}
              className={BTN}
              data-testid={`postgres-disconnect-${connection.connectorId}`}
              onClick={() => run(() => disconnectPostgresConnectionAction(connection.id))}
            >
              Disconnect
            </button>
          ) : null}
          {canAdmin && connection.status === "disconnected" ? (
            <button
              disabled={pending}
              className={BTN}
              data-testid={`postgres-remove-${connection.connectorId}`}
              onClick={() => {
                if (window.confirm(`Remove "${connection.name}" from this page? Its history is kept.`)) {
                  run(() => removePostgresConnectionAction(connection.id));
                }
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 font-mono-code text-[11px] text-outline">
        {connection.connectorId} · {connection.host}:{connection.port}/{connection.database} (
        {connection.sslmode})
      </p>
      <Result result={result} />

      {canAdmin ? (
        <div className="mt-space-md flex flex-col gap-space-sm">
          <CredentialsForm connectionId={connection.id} />
        </div>
      ) : null}

      <div className="mt-space-md">
        <h3 className="font-headline-sm text-body-sm font-semibold text-on-surface">Queries</h3>
        {connection.queries.length === 0 ? (
          <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">No queries defined yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-outline-variant/20" data-testid="postgres-queries">
            {connection.queries.map((query) => (
              <QueryRowView key={query.id} query={query} canDevelop={canDevelop} canAdmin={canAdmin} />
            ))}
          </ul>
        )}
        {canDevelop ? (
          <div className="mt-space-sm">
            <NewQueryForm connectionId={connection.id} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
