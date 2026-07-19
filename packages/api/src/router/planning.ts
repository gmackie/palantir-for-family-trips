import { and, asc, desc, eq, inArray, sql } from "@sortey/db";
import {
  pollOptions,
  polls,
  pollVotes,
  proposalReactions,
  proposals,
  trips,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { sendPushToTripMembers } from "../notifications/send";

function requireOrganizer(tripRole: "organizer" | "member") {
  if (tripRole !== "organizer") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organizers can perform this action.",
    });
  }
}

export const planningRouter = {
  // ── Polls ──────────────────────────────────────────────

  createPoll: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        title: z.string().min(1).max(200),
        pollType: z.enum([
          "date_range",
          "single_choice",
          "multi_choice",
          "ranked",
        ]),
        closesAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = (await ctx.db
        .insert(polls)
        .values({
          tripId: ctx.tripId,
          createdByUserId: ctx.session.user.id,
          title: input.title,
          pollType: input.pollType,
          closesAt: input.closesAt ? new Date(input.closesAt) : null,
        })
        .returning()) as Array<typeof polls.$inferSelect>;

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create poll.",
        });
      }

      void sendPushToTripMembers(ctx.db, {
        tripId: ctx.tripId,
        excludeUserId: ctx.session.user.id,
        title: "New Poll",
        body: created.title,
        data: { tripId: ctx.tripId, screen: "polls" },
      });

      return created;
    }),

  addPollOption: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        pollId: z.string().uuid(),
        label: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        url: z.string().url().optional(),
        sortOrder: z.number().int().nonnegative().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify poll belongs to this trip
      const [poll] = (await ctx.db
        .select({ id: polls.id })
        .from(polls)
        .where(and(eq(polls.id, input.pollId), eq(polls.tripId, ctx.tripId)))
        .limit(1)) as Array<{ id: string }>;

      if (!poll) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Poll not found in this trip.",
        });
      }

      const [created] = (await ctx.db
        .insert(pollOptions)
        .values({
          pollId: input.pollId,
          label: input.label,
          description: input.description ?? null,
          url: input.url ?? null,
          sortOrder: input.sortOrder,
        })
        .returning()) as Array<typeof pollOptions.$inferSelect>;

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add poll option.",
        });
      }

      return created;
    }),

  vote: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        pollOptionId: z.string().uuid(),
        response: z.enum(["yes", "no", "maybe", "prefer"]),
        rank: z.number().int().optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify poll option belongs to a poll in this trip
      const [option] = (await ctx.db
        .select({ id: pollOptions.id, pollId: pollOptions.pollId })
        .from(pollOptions)
        .innerJoin(polls, eq(polls.id, pollOptions.pollId))
        .where(
          and(
            eq(pollOptions.id, input.pollOptionId),
            eq(polls.tripId, ctx.tripId),
            eq(polls.status, "open"),
          ),
        )
        .limit(1)) as Array<{ id: string; pollId: string }>;

      if (!option) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Poll option not found or poll is closed.",
        });
      }

      const [upserted] = (await ctx.db
        .insert(pollVotes)
        .values({
          pollOptionId: input.pollOptionId,
          userId: ctx.session.user.id,
          response: input.response,
          rank: input.rank ?? null,
          note: input.note ?? null,
        })
        .onConflictDoUpdate({
          target: [pollVotes.pollOptionId, pollVotes.userId],
          set: {
            response: input.response,
            rank: input.rank ?? null,
            note: input.note ?? null,
          },
        })
        .returning()) as Array<typeof pollVotes.$inferSelect>;

      if (!upserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to record vote.",
        });
      }

      return upserted;
    }),

  closePoll: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        pollId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireOrganizer(ctx.tripRole);

      const [updated] = (await ctx.db
        .update(polls)
        .set({ status: "closed" as const })
        .where(and(eq(polls.id, input.pollId), eq(polls.tripId, ctx.tripId)))
        .returning()) as Array<typeof polls.$inferSelect>;

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Poll not found.",
        });
      }

      return updated;
    }),

  listPolls: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const pollRows = (await ctx.db
        .select()
        .from(polls)
        .where(eq(polls.tripId, ctx.tripId))
        .orderBy(desc(polls.createdAt))) as Array<typeof polls.$inferSelect>;

      // Batch-load options (with vote counts) for all polls in one query.
      const pollIds = pollRows.map((p) => p.id);
      const allOptions =
        pollIds.length > 0
          ? ((await ctx.db
              .select({
                id: pollOptions.id,
                pollId: pollOptions.pollId,
                label: pollOptions.label,
                description: pollOptions.description,
                url: pollOptions.url,
                sortOrder: pollOptions.sortOrder,
                createdAt: pollOptions.createdAt,
                voteCount: sql<number>`count(${pollVotes.id})::int`,
              })
              .from(pollOptions)
              .leftJoin(pollVotes, eq(pollVotes.pollOptionId, pollOptions.id))
              .where(inArray(pollOptions.pollId, pollIds))
              .groupBy(pollOptions.id)
              .orderBy(asc(pollOptions.sortOrder))) as Array<{
              id: string;
              pollId: string;
              label: string;
              description: string | null;
              url: string | null;
              sortOrder: number;
              createdAt: Date;
              voteCount: number;
            }>)
          : [];

      const optionsByPoll = new Map<string, typeof allOptions>();
      for (const option of allOptions) {
        const existing = optionsByPoll.get(option.pollId) ?? [];
        existing.push(option);
        optionsByPoll.set(option.pollId, existing);
      }

      return pollRows.map((poll) => ({
        ...poll,
        options: optionsByPoll.get(poll.id) ?? [],
      }));
    }),

  getPollResults: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        pollId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [poll] = (await ctx.db
        .select()
        .from(polls)
        .where(and(eq(polls.id, input.pollId), eq(polls.tripId, ctx.tripId)))
        .limit(1)) as Array<typeof polls.$inferSelect>;

      if (!poll) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Poll not found.",
        });
      }

      const options = (await ctx.db
        .select()
        .from(pollOptions)
        .where(eq(pollOptions.pollId, poll.id))
        .orderBy(asc(pollOptions.sortOrder))) as Array<
        typeof pollOptions.$inferSelect
      >;

      // Batch-load votes for all options in one query, preserving per-option
      // createdAt ordering via the global orderBy + stable grouping.
      const optionIds = options.map((o) => o.id);
      const votesByOption = new Map<
        string,
        Array<typeof pollVotes.$inferSelect>
      >();
      if (optionIds.length > 0) {
        const allVotes = (await ctx.db
          .select()
          .from(pollVotes)
          .where(inArray(pollVotes.pollOptionId, optionIds))
          .orderBy(asc(pollVotes.createdAt))) as Array<
          typeof pollVotes.$inferSelect
        >;
        for (const vote of allVotes) {
          const existing = votesByOption.get(vote.pollOptionId) ?? [];
          existing.push(vote);
          votesByOption.set(vote.pollOptionId, existing);
        }
      }

      const optionsWithVotes = options.map((option) => ({
        ...option,
        votes: votesByOption.get(option.id) ?? [],
      }));

      return { ...poll, options: optionsWithVotes };
    }),

  // ── Proposals ──────────────────────────────────────────

  createProposal: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        proposalType: z.enum([
          "flight",
          "lodging",
          "car_rental",
          "activity",
          "other",
        ]),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        url: z.string().url().optional(),
        priceCents: z.number().int().nonnegative().optional(),
        currency: z.string().max(8).default("USD"),
        priceNote: z.string().max(500).optional(),
        imageUrl: z.string().url().optional(),
        segmentId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = (await ctx.db
        .insert(proposals)
        .values({
          tripId: ctx.tripId,
          createdByUserId: ctx.session.user.id,
          proposalType: input.proposalType,
          title: input.title,
          description: input.description ?? null,
          url: input.url ?? null,
          priceCents: input.priceCents ?? null,
          currency: input.currency,
          priceNote: input.priceNote ?? null,
          imageUrl: input.imageUrl ?? null,
          segmentId: input.segmentId ?? null,
        })
        .returning()) as Array<typeof proposals.$inferSelect>;

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create proposal.",
        });
      }

      void sendPushToTripMembers(ctx.db, {
        tripId: ctx.tripId,
        excludeUserId: ctx.session.user.id,
        title: "New Proposal",
        body: created.title,
        data: { tripId: ctx.tripId, screen: "polls" },
      });

      return created;
    }),

  reactToProposal: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        proposalId: z.string().uuid(),
        reaction: z.enum(["up", "down", "interested", "booked"]),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify proposal belongs to this trip
      const [proposal] = (await ctx.db
        .select({ id: proposals.id })
        .from(proposals)
        .where(
          and(
            eq(proposals.id, input.proposalId),
            eq(proposals.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<{ id: string }>;

      if (!proposal) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proposal not found in this trip.",
        });
      }

      const [upserted] = (await ctx.db
        .insert(proposalReactions)
        .values({
          proposalId: input.proposalId,
          userId: ctx.session.user.id,
          reaction: input.reaction,
          note: input.note ?? null,
        })
        .onConflictDoUpdate({
          target: [proposalReactions.proposalId, proposalReactions.userId],
          set: {
            reaction: input.reaction,
            note: input.note ?? null,
          },
        })
        .returning()) as Array<typeof proposalReactions.$inferSelect>;

      if (!upserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to record reaction.",
        });
      }

      return upserted;
    }),

  updateProposalStatus: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        proposalId: z.string().uuid(),
        status: z.enum(["proposed", "selected", "booked", "rejected"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // selected/rejected require organizer
      if (input.status === "selected" || input.status === "rejected") {
        requireOrganizer(ctx.tripRole);
      }

      const updateValues: Record<string, unknown> = { status: input.status };
      if (input.status === "booked") {
        updateValues.bookedByUserId = ctx.session.user.id;
      }

      const [updated] = (await ctx.db
        .update(proposals)
        .set(updateValues)
        .where(
          and(
            eq(proposals.id, input.proposalId),
            eq(proposals.tripId, ctx.tripId),
          ),
        )
        .returning()) as Array<typeof proposals.$inferSelect>;

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proposal not found.",
        });
      }

      return updated;
    }),

  listProposals: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        proposalType: z
          .enum(["flight", "lodging", "car_rental", "activity", "other"])
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(proposals.tripId, ctx.tripId)];
      if (input.proposalType) {
        conditions.push(eq(proposals.proposalType, input.proposalType));
      }

      const proposalRows = (await ctx.db
        .select()
        .from(proposals)
        .where(and(...conditions))
        .orderBy(desc(proposals.createdAt))) as Array<
        typeof proposals.$inferSelect
      >;

      // Batch-load reaction counts for all proposals in one grouped query.
      const proposalIds = proposalRows.map((p) => p.id);
      const countsByProposal = new Map<string, Record<string, number>>();
      if (proposalIds.length > 0) {
        const reactionRows = (await ctx.db
          .select({
            proposalId: proposalReactions.proposalId,
            reaction: proposalReactions.reaction,
            count: sql<number>`count(*)::int`,
          })
          .from(proposalReactions)
          .where(inArray(proposalReactions.proposalId, proposalIds))
          .groupBy(
            proposalReactions.proposalId,
            proposalReactions.reaction,
          )) as Array<{
          proposalId: string;
          reaction: string;
          count: number;
        }>;
        for (const r of reactionRows) {
          const existing = countsByProposal.get(r.proposalId) ?? {};
          existing[r.reaction] = r.count;
          countsByProposal.set(r.proposalId, existing);
        }
      }

      return proposalRows.map((proposal) => ({
        ...proposal,
        reactionCounts: countsByProposal.get(proposal.id) ?? {},
      }));
    }),

  // ── Trip lifecycle ─────────────────────────────────────

  confirmTrip: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx }) => {
      requireOrganizer(ctx.tripRole);

      // Verify trip is in planning status
      const [trip] = (await ctx.db
        .select({ id: trips.id, status: trips.status })
        .from(trips)
        .where(eq(trips.id, ctx.tripId))
        .limit(1)) as Array<{ id: string; status: string }>;

      if (!trip) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Trip not found.",
        });
      }

      if (trip.status !== "planning") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Trip is already '${trip.status}', cannot confirm.`,
        });
      }

      // Close all open polls
      await ctx.db
        .update(polls)
        .set({ status: "closed" as const })
        .where(and(eq(polls.tripId, ctx.tripId), eq(polls.status, "open")));

      // Set trip status to confirmed
      const [updated] = (await ctx.db
        .update(trips)
        .set({ status: "confirmed" as const })
        .where(eq(trips.id, ctx.tripId))
        .returning()) as Array<typeof trips.$inferSelect>;

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to confirm trip.",
        });
      }

      return updated;
    }),
} satisfies TRPCRouterRecord;
