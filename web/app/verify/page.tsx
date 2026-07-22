import { VerifyWorkspace } from "@/components/verify/verify-workspace";

export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ receipt_id?: string }> }) {
  const { receipt_id } = await searchParams;
  const initial = typeof receipt_id === "string" ? receipt_id : undefined;
  return (
    <div className="mx-auto w-full max-w-[880px] px-5 py-16 sm:px-6 lg:py-20">
      <span className="t-label text-accent">Public verifier</span>
      <h1 className="t-h1 mt-3 text-primary">Verify a PreFlight Signed Receipt v1.</h1>
      <p className="t-lead mt-4 max-w-2xl text-secondary">
        Anyone can confirm that a receipt was issued by PreFlight, has not been altered, and applies to the
        identified runtime snapshot and policy version. No account, no capability token.
      </p>
      <div className="mt-8">
        <VerifyWorkspace initialReceiptId={initial} />
      </div>
    </div>
  );
}
