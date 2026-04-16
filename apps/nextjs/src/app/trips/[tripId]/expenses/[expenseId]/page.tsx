import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../../_lib/server";
import { ExpenseDetail } from "./_components/expense-detail";

export default async function ExpenseDetailPage(props: {
  params: Promise<{ tripId: string; expenseId: string }>;
}) {
  const { tripId, expenseId } = await props.params;
  const { caller, workspace, session } = await requireTripsWorkspace();

  try {
    const data = await caller.expenses.get({
      workspaceId: workspace.id,
      tripId,
      expenseId,
    });

    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <ExpenseDetail
          tripId={tripId}
          workspaceId={workspace.id}
          expenseId={expenseId}
          currentUserId={session.user.id}
          initialData={data}
        />
      </main>
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }

    throw error;
  }
}
