// supabase/functions/_shared/goal-steps/team.ts
//
// team_task: creates a card on the workspace's auto-provisioned "AI Goals"
// Trello-style board. Board + To Do list are created on first call.

import type { PlanStep, StepContext, StepResult } from "./types.ts";

export const kind = "team_task";

export function dryRun(step: PlanStep): StepResult {
  const p = step.params ?? {};
  return {
    status: "succeeded",
    output: {
      dry_run: true,
      summary: `Would create a team task: "${p.title ?? "(no title)"}"`,
      title: p.title,
      description: p.description,
      assigned_role: p.assigned_role,
    },
  };
}

export async function live(ctx: StepContext, step: PlanStep): Promise<StepResult> {
  const { admin, userId, workspaceId } = ctx;
  const p = step.params ?? {};
  const title = String(p.title ?? step.title ?? "Untitled task");
  const description = (p.description as string) ?? null;

  try {
    // Find or create the "AI Goals" board for this workspace.
    let boardId: string | null = null;
    {
      const { data: existing } = await admin
        .from("teamhub_boards")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", "AI Goals")
        .maybeSingle();
      if (existing?.id) {
        boardId = existing.id as string;
      } else {
        const { data: created, error: cerr } = await admin
          .from("teamhub_boards")
          .insert({ workspace_id: workspaceId, name: "AI Goals", created_by: userId })
          .select("id")
          .single();
        if (cerr || !created) {
          return { status: "skipped", output: { live: true, summary: `Couldn't auto-create AI Goals board: ${cerr?.message ?? "unknown"}.` }, error: cerr?.message };
        }
        boardId = created.id as string;
      }
    }

    // Find or create the "To Do" list on this board.
    let listId: string | null = null;
    {
      const { data: existing } = await admin
        .from("teamhub_lists")
        .select("id")
        .eq("board_id", boardId)
        .eq("name", "To Do")
        .maybeSingle();
      if (existing?.id) {
        listId = existing.id as string;
      } else {
        const { data: created, error: cerr } = await admin
          .from("teamhub_lists")
          .insert({ board_id: boardId, name: "To Do", position: 0 })
          .select("id")
          .single();
        if (cerr || !created) {
          return { status: "skipped", output: { live: true, summary: `Couldn't create To Do list: ${cerr?.message ?? "unknown"}.` }, error: cerr?.message };
        }
        listId = created.id as string;
      }
    }

    const { data: card, error: cardErr } = await admin
      .from("teamhub_cards")
      .insert({
        board_id: boardId,
        list_id: listId,
        title,
        description: description ?? `Created by goal executor — ${step.rationale ?? ""}`,
        created_by: userId,
      })
      .select("id")
      .single();

    if (cardErr || !card) {
      return { status: "failed", output: { live: true }, error: `team_task insert failed: ${cardErr?.message}` };
    }

    return {
      status: "succeeded",
      output: {
        live: true,
        summary: `Created team task "${title}" on the AI Goals board.`,
        card_id: card.id,
        board_id: boardId,
        list_id: listId,
      },
    };
  } catch (e) {
    return { status: "failed", output: { live: true }, error: `team_task threw: ${(e as Error).message}` };
  }
}
