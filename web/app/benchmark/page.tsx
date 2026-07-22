import { BenchmarkTable } from "@/components/benchmark/benchmark-table";

export default function BenchmarkPage() {
  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-16 sm:px-6 lg:py-20">
      <span className="t-label text-accent">Adversarial corpus</span>
      <h1 className="t-h1 mt-3 text-primary">What PreFlight catches.</h1>
      <p className="t-lead mt-4 max-w-2xl text-secondary">
        Every fixture is a seeded fault with an expected decision. Green means we caught it. Red means we did not.
        Any failing case is shown, not hidden. A benchmark that hides red is not evidence.
      </p>
      <BenchmarkTable />
    </div>
  );
}
