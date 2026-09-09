import MatchPage from "./match-page";

/**
 * Per-match archive page. Server component so the layout shell is in
 * the HTML on first paint; the page body is a client component that
 * fetches the record + handles re-judge / export. No 3D canvas /
 * live arena state lives here — this is a static, focused reading
 * surface per the v0.3.1 design.
 */
export const dynamic = "force-dynamic";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <MatchPage params={params} />;
}
