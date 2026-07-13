import Link from "next/link";
import { Wordmark } from "./wordmark";

const COLS = [
  {
    head: "Product",
    links: [
      { href: "/check", label: "Run a check" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/demo", label: "Demo" },
    ],
  },
  {
    head: "Developers",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/docs#api", label: "verify_release API" },
      { href: "/cli", label: "CLI" },
      { href: "/docs#mcp", label: "MCP server" },
      { href: "/gallery", label: "Gallery" },
    ],
  },
  {
    head: "Legal",
    links: [
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/terms", label: "Terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid w-full max-w-[1520px] gap-10 px-5 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-xs">
          <Wordmark href={null} />
          <p className="t-body mt-3 text-[15px] text-secondary">
            A release gate that behaves like a real customer. Deployed is not
            sellable.
          </p>
        </div>
        {COLS.map((c) => (
          <nav key={c.head} aria-label={c.head}>
            <p className="t-label mb-3 text-tertiary">{c.head}</p>
            <ul className="flex flex-col gap-2">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-secondary transition-colors hover:text-primary">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto w-full max-w-[1520px] border-t border-sep px-5 py-6 sm:px-6">
        <p className="t-evidence text-tertiary">
          Payments settle in USDT on X Layer via x402. Registered on OKX.AI.{" "}
          <a href="https://x.com/vinaystwt" target="_blank" rel="noopener noreferrer" className="text-secondary underline underline-offset-2 hover:text-primary">
            @vinaystwt
          </a>
        </p>
      </div>
    </footer>
  );
}
