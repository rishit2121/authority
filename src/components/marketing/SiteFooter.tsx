import Link from "next/link";

import { externalProps, FOOTER_COLUMNS, LEGAL_LINKS } from "@/lib/navigation";
import { supportEmail } from "@/lib/support";

import { Logo } from "./Logo";

export function SiteFooter() {
  const contact = supportEmail();
  const year = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-mkt-hairline bg-mkt-bg">
      <div className="mx-auto max-w-[1280px] px-6 pb-10 pt-16 md:px-10">
        <div className="grid grid-cols-1 gap-10 border-b border-mkt-hairline pb-12 md:grid-cols-4">
          <div className="flex flex-col gap-3 md:col-span-1">
            <div className="flex items-center gap-2">
              <Logo size={20} />
              <span className="text-[15px] font-semibold text-mkt-text">Authority</span>
            </div>
            <p className="max-w-xs text-[13px] leading-relaxed text-mkt-text-secondary">
              Give your agent tools. Set the limits.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <span className="text-[12px] font-medium uppercase tracking-wider text-mkt-text-secondary">
                {column.title}
              </span>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.label} className="text-[13px]">
                    <Link
                      href={link.href}
                      {...externalProps(link)}
                      className="text-mkt-text-secondary hover:text-mkt-text"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 pt-6 sm:flex-row">
          <p className="text-[13px] text-mkt-text-secondary">© {year} Authority.</p>
          <div className="flex items-center gap-5">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[13px] text-mkt-text-secondary hover:text-mkt-text"
              >
                {link.label}
              </Link>
            ))}
            {contact ? (
              <a
                href={`mailto:${contact}`}
                className="text-[13px] text-mkt-text-secondary hover:text-mkt-text"
              >
                Contact
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
