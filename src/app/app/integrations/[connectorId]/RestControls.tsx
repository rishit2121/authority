"use client";

import { useState, useTransition } from "react";

import {
  createRestConnectionAction,
  disconnectRestConnectionAction,
  updateRestConnectionAction,
  verifyRestConnectionAction,
  type RestActionResult,
} from "./actions";

export interface RestConnectorView {
  id: string;
  name: string;
  credential: { label: string; help: string; placeholder?: string };
  configFields: Array<{ key: string; label: string; placeholder?: string; help?: string }>;
}

export interface RestConnectionView {
  id: string;
  name: string;
  status: "setup_incomplete" | "unverified" | "verified" | "needs_attention" | "suspended" | "disconnected";
  config: Record<string, string>;
}

const STATUS_LABEL: Record<RestConnectionView["status"], string> = {
  setup_incomplete: "Setup incomplete",
  unverified: "Not verified",
  verified: "Verified",
  needs_attention: "Needs attention",
  suspended: "Suspended",
  disconnected: "Disconnected",
};
const STATUS_STYLE: Record<RestConnectionView["status"], string> = {
  setup_incomplete: "border-line text-ink-soft",
  unverified: "border-line text-ink-soft",
  verified: "border-allow/30 bg-allow/10 text-allow",
  needs_attention: "border-deny/40 bg-deny/10 text-deny",
  suspended: "border-line text-ink-soft",
  disconnected: "border-line text-ink-soft",
};

const BTN =
  "rounded-lg border border-line bg-paper px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY =
  "rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-soft focus:border-ink focus:outline-none";
const LABEL = "text-[11px] font-medium uppercase tracking-wider text-ink-soft";

function useAction() {
  const [result, setResult] = useState<RestActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<RestActionResult>) => start(async () => setResult(await fn()));
  return { result, pending, run };
}

function Result({ result }: { result: RestActionResult | null }) {
  if (!result) return null;
  const good = result.ok && result.verified !== false;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={`text-[13px] ${good ? "text-allow" : result.ok ? "text-ink-soft" : "text-deny"}`}
      data-testid="rest-result"
    >
      {result.ok ? (result.message ?? "Done.") : result.error}
    </p>
  );
}

function ConfigInputs({
  connector,
  values,
  onChange,
}: {
  connector: RestConnectorView;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      {connector.configFields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1">
          <span className={LABEL}>{field.label}</span>
          <input
            required
            value={values[field.key] ?? ""}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            className={`${INPUT} w-64`}
            autoComplete="off"
            data-testid={`rest-config-${field.key}`}
          />
          {field.help ? <span className="max-w-64 text-[11px] text-ink-soft">{field.help}</span> : null}
        </label>
      ))}
    </>
  );
}

export function ConnectForm({ connector }: { connector: RestConnectorView }) {
  const { result, pending, run } = useAction();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  return (
    <section
      className="rounded-[14px] border border-line bg-paper-raised p-6"
      aria-labelledby="rest-connect-heading"
    >
      <h2 id="rest-connect-heading" className="text-[15px] font-semibold text-ink">
        Connect {connector.name}
      </h2>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await createRestConnectionAction(connector.id, name, secret, config);
            if (r.ok) setSecret("");
            return r;
          });
        }}
      >
        <div className="flex flex-wrap items-start gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={connector.name}
              className={INPUT}
              data-testid="rest-name"
            />
          </label>
          <ConfigInputs
            connector={connector}
            values={config}
            onChange={(k, v) => setConfig((c) => ({ ...c, [k]: v }))}
          />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{connector.credential.label}</span>
            <input
              required
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={connector.credential.placeholder ?? "Paste it here"}
              className={`${INPUT} w-72`}
              autoComplete="off"
              data-testid="rest-secret"
            />
          </label>
        </div>
        <p className="max-w-2xl text-[12px] text-ink-soft">{connector.credential.help}</p>
        <div>
          <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="rest-connect">
            {pending ? "Saving…" : "Save and verify"}
          </button>
        </div>
      </form>
      <div className="mt-2">
        <Result result={result} />
      </div>
    </section>
  );
}

export function ConnectionCard({
  connector,
  connection,
  canAdmin,
}: {
  connector: RestConnectorView;
  connection: RestConnectionView;
  canAdmin: boolean;
}) {
  const action = useAction();
  const [secret, setSecret] = useState("");
  const [config, setConfig] = useState<Record<string, string>>(connection.config);
  const disconnected = connection.status === "disconnected";
  return (
    <section
      className="rounded-[14px] border border-line bg-paper-raised p-6"
      data-testid={`rest-connection-${connection.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{connection.name}</h3>
        <div className="flex items-center gap-2">
          <span
            className={`rounded border px-2 py-0.5 text-[11px] ${STATUS_STYLE[connection.status]}`}
            data-testid={`rest-status-${connection.id}`}
          >
            {STATUS_LABEL[connection.status]}
          </span>
          {canAdmin && !disconnected && connection.status !== "setup_incomplete" ? (
            <button
              type="button"
              disabled={action.pending}
              className={BTN}
              onClick={() => action.run(() => verifyRestConnectionAction(connector.id, connection.id))}
              data-testid={`rest-verify-${connection.id}`}
            >
              Verify
            </button>
          ) : null}
          {canAdmin && !disconnected ? (
            <button
              type="button"
              disabled={action.pending}
              className={BTN}
              onClick={() => action.run(() => disconnectRestConnectionAction(connector.id, connection.id))}
              data-testid={`rest-disconnect-${connection.id}`}
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </div>
      {Object.keys(connection.config).length > 0 ? (
        <p className="mt-1 text-[12px] text-ink-soft">
          {connector.configFields
            .filter((f) => connection.config[f.key])
            .map((f) => `${f.label}: ${connection.config[f.key]}`)
            .join(" · ")}
        </p>
      ) : null}
      <div className="mt-2">
        <Result result={action.result} />
      </div>
      {canAdmin && !disconnected ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              const r = await updateRestConnectionAction(
                connector.id,
                connection.id,
                secret,
                connector.configFields.length > 0 ? config : null,
              );
              if (r.ok) setSecret("");
              return r;
            });
          }}
        >
          <ConfigInputs
            connector={connector}
            values={config}
            onChange={(k, v) => setConfig((c) => ({ ...c, [k]: v }))}
          />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Replace {connector.credential.label.toLowerCase()}</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Leave empty to keep the current one"
              className={`${INPUT} w-72`}
              autoComplete="off"
              data-testid={`rest-replace-secret-${connection.id}`}
            />
          </label>
          <button type="submit" disabled={action.pending} className={BTN}>
            Save and verify
          </button>
        </form>
      ) : null}
    </section>
  );
}
