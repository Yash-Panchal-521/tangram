import { InviteView } from "@/components/invite/InviteView";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ accept?: string }>;
}) {
  const [{ token }, { accept }] = await Promise.all([params, searchParams]);

  // Set only by the sign-up round trip. Someone who merely happens to be signed
  // in when they open a link is still asked.
  return <InviteView token={token} autoAccept={accept === "1"} />;
}
