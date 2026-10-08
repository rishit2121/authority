"use client";

import { useState, useTransition } from "react";

import { CUSTOM_API_TEMPLATES, type CustomApiTemplate } from "@/lib/connectors/custom-api/templates";

import {
  createCustomApiConnectionAction,
  createCustomOperationAction,
  deleteCustomOperationDraftAction,
  disconnectCustomApiConnectionAction,
  previewCustomOperationAction,
  publishCustomOperationAction,
  retireCustomOperationAction,
  setCustomApiSecretAction,
  updateCustomApiBaseUrlAction,
  validateCustomOperationAction,
  type CustomApiActionResult,
  type PreviewRequestResult,
} from "./actions";
import type { ConnectionRow, OperationRow } from "./page";

const BTN =
  "rounded-lg border border-outline-variant/40 bg-surface-container-high px-space-md py-1.5 font-body-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface placeholder:text-outline";

function useAction<T extends CustomApiActionResult = CustomApiActionResult>() {
  const [result, setResult] = useState<T | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<T>) =>
    start(async () => {
      setResult(await fn());
    });
  return { result, pending, run };
}

function Result({ result }: { result: CustomApiActionResult | null }) {
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
  const [baseUrl, setBaseUrl] = useState("https://");

  return (
    <section
      aria-labelledby="new-connection-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
    >
      <h2
        id="new-connection-heading"
        className="font-headline-sm text-headline-sm font-semibold text-on-surface"
      >
        New connection
      </h2>
      <form
        className="mt-space-sm flex flex-wrap items-end gap-space-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createCustomApiConnectionAction(name, baseUrl));
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Widget Orders API"
            className={INPUT}
            data-testid="custom-api-name"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Base URL</span>
          <input
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com"
            className={`${INPUT} w-72`}
            data-testid="custom-api-base-url"
          />
        </label>
        <button type="submit" disabled={pending} className={BTN_PRIMARY} data-testid="custom-api-connect">
          Connect
        </button>
      </form>
      <p className="mt-space-sm font-body-sm text-body-sm text-outline">
        HTTPS only. The destination is re-validated on every request — private, loopback, and link-local
        addresses (including cloud metadata endpoints) are always refused, even if DNS later points there.
      </p>
      <Result result={result} />
    </section>
  );
}

function BaseUrlForm({ connectionId, baseUrl }: { connectionId: string; baseUrl: string | null }) {
  const { result, pending, run } = useAction();
  const [value, setValue] = useState(baseUrl ?? "https://");
  return (
    <form
      className="flex flex-wrap items-end gap-space-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateCustomApiBaseUrlAction(connectionId, value));
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Base URL</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} className={`${INPUT} w-72`} />
      </label>
      <button type="submit" disabled={pending} className={BTN}>
        Save
      </button>
      <Result result={result} />
    </form>
  );
}

const SECRET_TYPES = [
  { value: "bearer_token", label: "Bearer token" },
  { value: "api_key", label: "API key" },
  { value: "basic_username", label: "Basic auth username" },
  { value: "basic_password", label: "Basic auth password" },
] as const;

function SecretForm({ connectionId }: { connectionId: string }) {
  const { result, pending, run } = useAction();
  const [secretType, setSecretType] = useState<(typeof SECRET_TYPES)[number]["value"]>("bearer_token");
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-space-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setCustomApiSecretAction(connectionId, secretType, value));
        setValue("");
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Credential</span>
        <select
          value={secretType}
          onChange={(e) => setSecretType(e.target.value as (typeof SECRET_TYPES)[number]["value"])}
          className={INPUT}
        >
          {SECRET_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Value</span>
        <input
          required
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`${INPUT} w-64`}
          autoComplete="off"
          data-testid="custom-api-secret-value"
        />
      </label>
      <button type="submit" disabled={pending} className={BTN} data-testid="custom-api-save-secret">
        Save credential
      </button>
      <Result result={result} />
      <p className="basis-full font-body-sm text-body-sm text-outline">
        Stored in Supabase Vault, keyed by reference only. It is never returned to this browser, never logged,
        and resolved only at the moment a connector dispatches an authorized request.
      </p>
    </form>
  );
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const EFFECTS = ["read", "write_create", "write_update", "write_delete", "admin"] as const;
const AUTH_TYPES = ["none", "bearer", "api_key_header", "basic"] as const;
const ARG_LOCATIONS = ["path", "query", "body"] as const;
const ARG_TYPES = ["string", "number", "boolean"] as const;

interface DraftField {
  key: string;
  in: (typeof ARG_LOCATIONS)[number];
  type: (typeof ARG_TYPES)[number];
  required: boolean;
  identifiesResource: boolean;
}

const emptyField = (identifiesResource = false): DraftField => ({
  key: "",
  in: "path",
  type: "string",
  required: true,
  identifiesResource,
});

function FieldRow({
  field,
  onChange,
  onRemove,
  removable,
}: {
  field: DraftField;
  onChange: (next: DraftField) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-end gap-space-sm rounded border border-outline-variant/20 p-space-sm"
      data-testid="custom-api-field-row"
    >
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Key</span>
        <input
          required
          value={field.key}
          onChange={(e) => onChange({ ...field, key: e.target.value })}
          className={INPUT}
          data-testid="custom-api-field-key"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Located in</span>
        <select
          value={field.in}
          onChange={(e) => onChange({ ...field, in: e.target.value as DraftField["in"] })}
          className={INPUT}
          data-testid="custom-api-field-in"
        >
          {ARG_LOCATIONS.map((loc) => (
            <option key={loc}>{loc}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Type</span>
        <select
          value={field.type}
          onChange={(e) => onChange({ ...field, type: e.target.value as DraftField["type"] })}
          className={INPUT}
        >
          {ARG_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 pb-1.5">
        <input
          type="checkbox"
          checked={field.required}
          disabled={field.in === "path"}
          onChange={(e) => onChange({ ...field, required: e.target.checked })}
        />
        <span className="font-body-sm text-body-sm text-on-surface-variant">Required</span>
      </label>
      <label className="flex items-center gap-2 pb-1.5">
        <input
          type="checkbox"
          checked={field.identifiesResource}
          onChange={(e) => onChange({ ...field, identifiesResource: e.target.checked })}
          data-testid="custom-api-field-identifies-resource"
        />
        <span className="font-body-sm text-body-sm text-on-surface-variant">Identifies resource</span>
      </label>
      {removable ? (
        <button type="button" className={BTN} onClick={onRemove}>
          Remove
        </button>
      ) : null}
    </div>
  );
}

function RequestPreview({
  baseUrl,
  method,
  pathTemplate,
  authType,
  headerName,
  fields,
  staticHeaders,
  sampleValues,
  onSampleValueChange,
}: {
  baseUrl: string | null;
  method: (typeof METHODS)[number];
  pathTemplate: string;
  authType: (typeof AUTH_TYPES)[number];
  headerName: string;
  fields: DraftField[];
  staticHeaders: Array<{ name: string; value: string }>;
  sampleValues: Record<string, string>;
  onSampleValueChange: (key: string, value: string) => void;
}) {
  const { result, pending, run } = useAction<PreviewRequestResult>();

  return (
    <div className="flex flex-col gap-space-sm rounded border border-outline-variant/20 p-space-sm">
      <p className="font-body-sm text-body-sm font-medium text-on-surface">Preview with sample values</p>
      <div className="flex flex-wrap gap-space-sm">
        {fields
          .filter((f) => f.key)
          .map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                {f.key}
              </span>
              <input
                value={sampleValues[f.key] ?? ""}
                onChange={(e) => onSampleValueChange(f.key, e.target.value)}
                className={`${INPUT} w-36`}
                data-testid={`custom-api-sample-${f.key}`}
              />
            </label>
          ))}
      </div>
      <div>
        <button
          type="button"
          disabled={pending}
          className={BTN}
          data-testid="custom-api-preview-request"
          onClick={() =>
            run(() =>
              previewCustomOperationAction({
                baseUrl: baseUrl ?? "",
                method,
                pathTemplate,
                authType,
                headerName,
                staticHeaders,
                fields: fields
                  .filter((f) => f.key)
                  .map((f) => ({
                    key: f.key,
                    type: f.type,
                    required: f.in === "path" ? true : f.required,
                    identifiesResource: f.identifiesResource,
                    in: f.in,
                  })),
                sampleValues,
              }),
            )
          }
        >
          Preview request
        </button>
      </div>
      {result?.ok && result.preview ? (
        <pre
          className="overflow-x-auto rounded bg-surface-container-high p-space-sm font-mono-code text-[11px] text-on-surface"
          data-testid="custom-api-preview-output"
        >
          {result.preview.method} {result.preview.url}
          {"\n"}
          {Object.entries(result.preview.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")}
          {result.preview.body ? `\n\n${result.preview.body}` : ""}
        </pre>
      ) : null}
      {result && !result.ok ? <Result result={result} /> : null}
    </div>
  );
}

function TemplatePicker({ onApply }: { onApply: (template: CustomApiTemplate) => void }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = CUSTOM_API_TEMPLATES.find((t) => t.id === selectedId) ?? null;
  return (
    <div className="flex flex-col gap-space-sm rounded border border-outline-variant/20 bg-surface-container-low p-space-sm">
      <label className="flex flex-col gap-1">
        <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
          Start from a template (optional)
        </span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={INPUT}
          data-testid="custom-api-template-select"
        >
          <option value="">— pick a starting point —</option>
          {CUSTOM_API_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.service}: {t.name}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <div className="flex flex-col gap-1 font-body-sm text-body-sm text-on-surface-variant">
          <p>{selected.description}</p>
          <p>
            <strong>Base URL:</strong> <code className="font-mono-code">{selected.recommendedBaseUrl}</code> —
            set this on the connection above.
          </p>
          <p>
            <strong>Credential:</strong> {selected.authNote}
          </p>
          <p className="text-outline">
            <strong>Best-effort, not live-verified</strong> against this provider — built from its public API
            docs, the same as filling the form in by hand. {selected.verify} Always run &quot;Preview
            request&quot; and check the provider&apos;s current docs before publishing.
          </p>
          <button
            type="button"
            className={BTN}
            data-testid="custom-api-template-apply"
            onClick={() => onApply(selected)}
          >
            Fill in the form below
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NewOperationForm({ connectionId, baseUrl }: { connectionId: string; baseUrl: string | null }) {
  const { result, pending, run } = useAction();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("GET");
  const [pathTemplate, setPathTemplate] = useState("/v1/orders/{orderId}");
  const [effect, setEffect] = useState<(typeof EFFECTS)[number]>("read");
  const [authType, setAuthType] = useState<(typeof AUTH_TYPES)[number]>("none");
  const [headerName, setHeaderName] = useState("");
  const [fields, setFields] = useState<DraftField[]>([{ ...emptyField(true), key: "orderId" }]);
  const [staticHeaders, setStaticHeaders] = useState<Array<{ name: string; value: string }>>([]);
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});

  const updateField = (index: number, next: DraftField) => {
    setFields((prev) => prev.map((f, i) => (i === index ? next : f)));
  };
  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };
  const setSampleValue = (key: string, value: string) => {
    setSampleValues((prev) => ({ ...prev, [key]: value }));
  };
  const applyTemplate = (template: CustomApiTemplate) => {
    setSlug(template.id.replace(/-/g, "_"));
    setName(template.name);
    setMethod(template.method);
    setPathTemplate(template.pathTemplate);
    setEffect(template.effect);
    setAuthType(template.authType);
    setHeaderName(template.headerName ?? "");
    setFields(
      template.fields.map((f) => ({
        key: f.key,
        in: f.in,
        type: f.type,
        required: f.required,
        identifiesResource: f.identifiesResource,
      })),
    );
    setStaticHeaders(template.staticHeaders);
  };

  return (
    <form
      className="flex flex-col gap-space-sm rounded-lg border border-dashed border-outline-variant/40 p-space-md"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          createCustomOperationAction({
            connectionId,
            operationSlug: slug,
            name,
            method,
            pathTemplate,
            effect,
            authType,
            headerName: authType === "api_key_header" ? headerName : undefined,
            staticHeaders,
            fields: fields.map((f) => ({
              key: f.key,
              type: f.type,
              required: f.in === "path" ? true : f.required,
              identifiesResource: f.identifiesResource,
              in: f.in,
            })),
          }),
        );
      }}
    >
      <p className="font-headline-sm text-body-sm font-semibold text-on-surface">New operation (draft)</p>
      <TemplatePicker onApply={applyTemplate} />
      <div className="flex flex-wrap gap-space-sm">
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Slug</span>
          <input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="get_order"
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Get order"
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Method</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}
            className={INPUT}
          >
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
            Path template
          </span>
          <input
            required
            value={pathTemplate}
            onChange={(e) => setPathTemplate(e.target.value)}
            className={`${INPUT} w-56`}
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
        <label className="flex flex-col gap-1">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Auth</span>
          <select
            value={authType}
            onChange={(e) => setAuthType(e.target.value as (typeof AUTH_TYPES)[number])}
            className={INPUT}
          >
            {AUTH_TYPES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        {authType === "api_key_header" ? (
          <label className="flex flex-col gap-1">
            <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
              Header name
            </span>
            <input
              required
              value={headerName}
              onChange={(e) => setHeaderName(e.target.value)}
              placeholder="X-Api-Key"
              className={INPUT}
              data-testid="custom-api-header-name"
            />
          </label>
        ) : null}
      </div>

      <p className="font-body-sm text-body-sm text-outline">
        1-20 fields, spanning path/query/body. Required/optional and the field&apos;s type (string, number, or
        boolean) are the only input constraints enforced. Exactly one field must be marked &quot;Identifies
        resource&quot; — that value is what a capability binds against — and every path-located field is
        always required.
      </p>
      <div className="flex flex-col gap-space-sm">
        {fields.map((field, index) => (
          <FieldRow
            key={index}
            field={field}
            onChange={(next) => updateField(index, next)}
            onRemove={() => removeField(index)}
            removable={fields.length > 1}
          />
        ))}
      </div>
      <div className="flex items-center gap-space-sm">
        <button
          type="button"
          className={BTN}
          data-testid="custom-api-add-field"
          onClick={() => setFields((prev) => [...prev, emptyField()])}
        >
          Add field
        </button>
      </div>

      <div className="flex flex-col gap-space-sm">
        <p className="font-body-sm text-body-sm text-outline">
          Fixed headers sent on every call to this operation — never a credential (that is set only via Auth
          above, and &quot;Authorization&quot; cannot be set here).
        </p>
        {staticHeaders.map((h, index) => (
          <div key={index} className="flex flex-wrap items-end gap-space-sm">
            <label className="flex flex-col gap-1">
              <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                Header name
              </span>
              <input
                value={h.name}
                onChange={(e) =>
                  setStaticHeaders((prev) =>
                    prev.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)),
                  )
                }
                placeholder="Notion-Version"
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Value</span>
              <input
                value={h.value}
                onChange={(e) =>
                  setStaticHeaders((prev) =>
                    prev.map((x, i) => (i === index ? { ...x, value: e.target.value } : x)),
                  )
                }
                className={INPUT}
              />
            </label>
            <button
              type="button"
              className={BTN}
              onClick={() => setStaticHeaders((prev) => prev.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className={BTN}
            onClick={() => setStaticHeaders((prev) => [...prev, { name: "", value: "" }])}
          >
            Add static header
          </button>
        </div>
      </div>

      <RequestPreview
        baseUrl={baseUrl}
        method={method}
        pathTemplate={pathTemplate}
        authType={authType}
        headerName={headerName}
        fields={fields}
        staticHeaders={staticHeaders}
        sampleValues={sampleValues}
        onSampleValueChange={setSampleValue}
      />

      <div className="flex items-center gap-space-sm">
        <button
          type="submit"
          disabled={pending}
          className={BTN_PRIMARY}
          data-testid="custom-api-create-operation"
        >
          Create draft
        </button>
      </div>
      <Result result={result} />
    </form>
  );
}

function UseThisOperation({ operation }: { operation: OperationRow }) {
  const scope = operation.toolName.slice(operation.toolName.indexOf(".") + 1);
  const authorizeBody = JSON.stringify(
    {
      taskId: "<your task id>",
      tool: operation.toolName,
      operation: scope,
      resource: "<the identifying value, e.g. an order id>",
      arguments: { "...": "..." },
      idempotencyKey: "<a key unique to this call>",
    },
    null,
    2,
  );
  const executeBody = JSON.stringify(
    {
      capability: "<the token from the authorize response>",
      tool: operation.toolName,
      operation: scope,
      resource: "<the same identifying value>",
      arguments: { "...": "..." },
      idempotencyKey: "<a key unique to this call>",
    },
    null,
    2,
  );
  return (
    <details className="mt-1.5 w-full">
      <summary className="cursor-pointer text-[12px] font-medium text-outline marker:content-none">
        <span className="inline-flex items-center gap-1">
          <span>›</span> Use this operation
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-space-sm">
        <p className="font-body-sm text-body-sm text-outline">
          1. Authorize the call (mints a single-use capability):
        </p>
        <pre className="overflow-x-auto rounded bg-surface-container-high p-space-sm font-mono-code text-[11px] text-on-surface">
          {`POST /api/v1/authorize\nAuthorization: Bearer <agent runtime key>\n\n${authorizeBody}`}
        </pre>
        <p className="font-body-sm text-body-sm text-outline">2. Execute it with the issued capability:</p>
        <pre className="overflow-x-auto rounded bg-surface-container-high p-space-sm font-mono-code text-[11px] text-on-surface">
          {`POST /api/v1/execute\nAuthorization: Bearer <agent runtime key>\n\n${executeBody}`}
        </pre>
        <p className="font-body-sm text-body-sm text-outline">
          See docs/api/RUNTIME_API.md and docs/api/OPENAPI.yaml for the full request/response contract.
        </p>
      </div>
    </details>
  );
}

function OperationRowView({
  operation,
  canDevelop,
  canAdmin,
}: {
  operation: OperationRow;
  canDevelop: boolean;
  canAdmin: boolean;
}) {
  const { result, pending, run } = useAction();
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-space-sm py-2.5"
      data-testid={`custom-api-op-${operation.operationSlug}`}
    >
      <div>
        <span className="font-mono-code text-[13px] text-on-surface">
          {operation.method} {operation.pathTemplate}
        </span>
        <span className="ml-2 font-body-sm text-body-sm text-outline">
          {operation.toolName} · {operation.effect} · auth: {operation.authType}
        </span>
        {operation.status === "published" ? <UseThisOperation operation={operation} /> : null}
      </div>
      <div className="flex items-center gap-space-sm">
        <span
          className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${
            operation.status === "published"
              ? "border-allow/30 bg-allow/10 text-allow"
              : operation.status === "retired"
                ? "border-outline-variant/40 bg-surface-container-high text-on-surface-variant"
                : "border-secondary/40 bg-secondary/10 text-secondary"
          }`}
        >
          {operation.status}
        </span>
        {operation.status === "draft" && canDevelop ? (
          <>
            <button
              disabled={pending}
              className={BTN}
              onClick={() => run(() => validateCustomOperationAction(operation.id))}
            >
              Validate
            </button>
            <button
              disabled={pending}
              className={BTN}
              onClick={() => run(() => deleteCustomOperationDraftAction(operation.id))}
            >
              Delete
            </button>
          </>
        ) : null}
        {operation.status === "validated" && canAdmin ? (
          <button
            disabled={pending}
            className={BTN_PRIMARY}
            data-testid={`custom-api-publish-${operation.operationSlug}`}
            onClick={() => run(() => publishCustomOperationAction(operation.id))}
          >
            Publish
          </button>
        ) : null}
        {operation.status === "published" && canAdmin ? (
          <button
            disabled={pending}
            className={BTN}
            onClick={() => run(() => retireCustomOperationAction(operation.id))}
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
      data-testid={`custom-api-connection-${connection.connectorId}`}
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
              data-testid={`custom-api-disconnect-${connection.connectorId}`}
              onClick={() => run(() => disconnectCustomApiConnectionAction(connection.id))}
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 font-mono-code text-[11px] text-outline">
        {connection.connectorId}
        {connection.baseUrl ? ` · ${connection.baseUrl}` : ""}
      </p>
      <Result result={result} />

      {canAdmin ? (
        <div className="mt-space-md flex flex-col gap-space-md">
          <div className="flex flex-col gap-space-sm">
            <p className="font-label-caps text-[11px] uppercase tracking-wider text-outline">
              1 · Connection
            </p>
            <BaseUrlForm connectionId={connection.id} baseUrl={connection.baseUrl} />
          </div>
          <div className="flex flex-col gap-space-sm">
            <p className="font-label-caps text-[11px] uppercase tracking-wider text-outline">
              2 · Authentication
            </p>
            <SecretForm connectionId={connection.id} />
          </div>
        </div>
      ) : null}

      <div className="mt-space-md flex flex-col gap-space-sm">
        <p className="font-label-caps text-[11px] uppercase tracking-wider text-outline">3 · Operations</p>
        {connection.operations.length === 0 ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant">No operations defined yet.</p>
        ) : (
          <ul className="divide-y divide-outline-variant/20" data-testid="custom-api-operations">
            {connection.operations.map((op) => (
              <OperationRowView key={op.id} operation={op} canDevelop={canDevelop} canAdmin={canAdmin} />
            ))}
          </ul>
        )}
        {canDevelop ? <NewOperationForm connectionId={connection.id} baseUrl={connection.baseUrl} /> : null}
      </div>
    </section>
  );
}
