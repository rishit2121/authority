import type { Metadata } from "next";
import Link from "next/link";

import { DocsPage, DocsSection } from "@/components/docs/DocsPage";
import { supportEmail } from "@/lib/support";

export const metadata: Metadata = { title: "Privacy — Authority" };
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const contact = supportEmail();
  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-16">
      <DocsPage
        title="Privacy"
        description="What Authority stores, why, and who else touches it. Plain language, no surprises."
      >
        <DocsSection title="What we store">
          <ul className="list-disc pl-5">
            <li>Your account: name, email address, and a password hash (never the password itself).</li>
            <li>
              What you create in your workspace: agents, applications, tasks, the plans and contracts that
              grant access, approvals, and an audit log of every authorization decision and tool call.
            </li>
            <li>
              Credentials for the services you connect (API keys, bot tokens, OAuth refresh tokens). These are
              stored encrypted and are only ever used to make the requests your agents are authorized to make.
              They are never shown again, logged, or sent to your browser or your agents.
            </li>
            <li>
              The ids you send for your own users (for example &quot;user-123&quot;) — we never need their
              names.
            </li>
          </ul>
        </DocsSection>

        <DocsSection title="What we don't do">
          <p>
            No advertising, no selling or sharing your data, and no third-party analytics or tracking scripts
            on this site or in the app.
          </p>
        </DocsSection>

        <DocsSection title="Services we rely on">
          <ul className="list-disc pl-5">
            <li>Supabase — database and sign-in.</li>
            <li>Render — application hosting.</li>
            <li>
              OpenAI (or OpenRouter) — only when you ask Authority to draft a plan from a task description.
              The description and the names of the tools available are sent; credentials and tool results are
              not.
            </li>
            <li>The services you connect — only the requests your agents are authorized to make.</li>
          </ul>
        </DocsSection>

        <DocsSection title="Your control">
          <p>
            You can disconnect any service or revoke any key at any time from the dashboard; it stops working
            immediately. To export or delete your account and workspace data, contact us
            {contact ? (
              <>
                {" "}
                at <a href={`mailto:${contact}`}>{contact}</a>
              </>
            ) : null}
            .
          </p>
          <p>
            How access is enforced is described in the <Link href="/docs">documentation</Link>.
          </p>
        </DocsSection>
      </DocsPage>
    </div>
  );
}
