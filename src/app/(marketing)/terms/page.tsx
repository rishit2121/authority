import type { Metadata } from "next";

import { DocsPage, DocsSection } from "@/components/docs/DocsPage";
import { supportEmail } from "@/lib/support";

export const metadata: Metadata = { title: "Terms — Authority" };
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const contact = supportEmail();
  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-16">
      <DocsPage
        title="Terms of use"
        description="The short version of the deal for using Authority during early access."
      >
        <DocsSection title="The service">
          <p>
            Authority limits what your AI agents can do with the services you connect. It is in early access:
            it is provided as is, features may change, and we may occasionally need to take it offline for
            maintenance.
          </p>
        </DocsSection>

        <DocsSection title="Your responsibilities">
          <ul className="list-disc pl-5">
            <li>
              Keep your keys secret. Anyone with a key can act as the agent or application it belongs to.
            </li>
            <li>
              You are responsible for your agents, the services you connect, and the actions you approve.
              Authority narrows and records access; it does not make your agent&apos;s decisions for it.
            </li>
            <li>
              Only connect accounts you are allowed to connect, and don&apos;t use Authority for anything
              unlawful or to attack, overload, or probe other systems.
            </li>
          </ul>
        </DocsSection>

        <DocsSection title="Our side">
          <p>
            We may suspend accounts that abuse the service. To the extent the law allows, we are not liable
            for indirect or consequential losses arising from use of the service during early access.
          </p>
        </DocsSection>

        <DocsSection title="Changes and contact">
          <p>
            If these terms change, the updated version will be posted here.
            {contact ? (
              <>
                {" "}
                Questions: <a href={`mailto:${contact}`}>{contact}</a>.
              </>
            ) : null}
          </p>
        </DocsSection>
      </DocsPage>
    </div>
  );
}
