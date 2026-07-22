import { CheckWorkspace } from "@/components/check/check-workspace";

export const dynamic = "force-dynamic";

export default async function CheckPage({ searchParams }: { searchParams: Promise<{ agent_id?: string; endpoint?: string }> }) {
  const { agent_id, endpoint } = await searchParams;
  const initialInput = typeof agent_id === "string" ? agent_id : typeof endpoint === "string" ? endpoint : undefined;
  return <CheckWorkspace initialInput={initialInput} />;
}
