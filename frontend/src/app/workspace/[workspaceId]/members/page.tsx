import { AppShell } from "@/components/nav/AppShell";
import { WorkspaceMembersView } from "@/components/workspace/WorkspaceMembersView";

export default async function WorkspaceMembersPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return (
    <AppShell workspaceId={workspaceId}>
      <WorkspaceMembersView workspaceId={workspaceId} />
    </AppShell>
  );
}
