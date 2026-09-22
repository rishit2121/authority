import { Icon, type IconName } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

interface RiskCard {
  icon: IconName;
  iconClass: string;
  title: string;
  body: string;
  risk: string;
}

const RISK_CARDS: RiskCard[] = [
  {
    icon: "key",
    iconClass: "text-primary",
    title: "Standing credentials",
    body: "Engineers paste GitHub, Slack, and cloud API tokens directly into agent containers. The agent possesses account-wide blast radius 24/7, even when given a trivial reading prompt.",
    risk: "RISK: Full Account Compromise",
  },
  {
    icon: "account_tree",
    iconClass: "text-secondary",
    title: "Untrusted plans",
    body: "Stochastic reasoning, hallucinated dependencies, and indirect prompt injections silently inject unverified tools or exfiltration destinations into the execution chain without review.",
    risk: "RISK: Prompt Injection & Data Leakage",
  },
  {
    icon: "mark_chat_read",
    iconClass: "text-tertiary-fixed-dim",
    title: "Approval fatigue",
    body: 'Interrupting human operators with Slack or modal notifications for every atomic API sub-call trains developers to click "Approve All" without inspecting parameter payloads.',
    risk: "RISK: Rubber-Stamp Security Failures",
  },
];

export function ProblemStatement() {
  return (
    <Section id="product">
      <SectionHeading
        align="center"
        eyebrow="The Structural Flaw"
        title="Agents should not inherit the keys to your company."
        description="Today's autonomous agents inherit account-wide standing access. They should receive scoped, dynamic capabilities tailored strictly to each validated user objective."
        className="mx-auto max-w-3xl mb-space-2xl"
      />

      <div className="grid grid-cols-1 gap-space-lg md:grid-cols-3">
        {RISK_CARDS.map((card) => (
          <Panel key={card.title} interactive className="flex flex-col justify-between">
            <div>
              <div className="mb-space-lg flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-high">
                <Icon name={card.icon} size={22} className={card.iconClass} />
              </div>
              <h3 className="mb-space-sm font-headline-sm text-headline-sm font-semibold text-on-surface">
                {card.title}
              </h3>
              <p className="font-body-md text-body-md leading-relaxed text-on-surface-variant">{card.body}</p>
            </div>
            <div className="mt-space-lg border-t border-outline-variant/20 pt-space-md font-mono-code text-[11px] text-outline">
              {card.risk}
            </div>
          </Panel>
        ))}
      </div>
    </Section>
  );
}
