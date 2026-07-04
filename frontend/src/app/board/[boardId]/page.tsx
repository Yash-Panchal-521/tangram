import { BoardView } from "@/components/board/BoardView";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  return <BoardView boardId={boardId} />;
}
