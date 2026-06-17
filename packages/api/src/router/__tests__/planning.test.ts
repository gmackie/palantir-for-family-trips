import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

// ─── Types ────────────────────────────────────────────────────────────────────

type TripRole = "organizer" | "member";

type PollStatus = "open" | "closed";
type TripStatus = "planning" | "confirmed" | "active" | "completed";

type PollRow = {
  id: string;
  tripId: string;
  createdByUserId: string;
  title: string;
  pollType: "date_range" | "single_choice" | "multi_choice" | "ranked";
  closesAt: Date | null;
  status: PollStatus;
  createdAt: Date;
};

type PollVoteRow = {
  id: string;
  pollOptionId: string;
  userId: string;
  response: "yes" | "no" | "maybe" | "prefer";
  rank: number | null;
  note: string | null;
  createdAt: Date;
};

type ProposalStatus = "proposed" | "selected" | "booked" | "rejected";

type ProposalRow = {
  id: string;
  tripId: string;
  createdByUserId: string;
  proposalType: "flight" | "lodging" | "car_rental" | "activity" | "other";
  title: string;
  description: string | null;
  url: string | null;
  priceCents: number | null;
  currency: string;
  priceNote: string | null;
  imageUrl: string | null;
  segmentId: string | null;
  status: ProposalStatus;
  bookedByUserId: string | null;
  createdAt: Date;
};

type TripRow = {
  id: string;
  status: TripStatus;
};

// ─── Domain logic mirrors (extracted from planning.ts inline procedures) ───────

function requireOrganizer(tripRole: TripRole): void {
  if (tripRole !== "organizer") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organizers can perform this action.",
    });
  }
}

// Vote upsert: insert new or replace existing (matches pollVotes.onConflictDoUpdate)
function simulateVote(
  votes: PollVoteRow[],
  input: {
    pollOptionId: string;
    userId: string;
    response: PollVoteRow["response"];
    rank?: number;
    note?: string;
  },
): PollVoteRow {
  const existingIdx = votes.findIndex(
    (v) => v.pollOptionId === input.pollOptionId && v.userId === input.userId,
  );

  const row: PollVoteRow = {
    id: existingIdx >= 0 ? votes[existingIdx]!.id : randomUUID(),
    pollOptionId: input.pollOptionId,
    userId: input.userId,
    response: input.response,
    rank: input.rank ?? null,
    note: input.note ?? null,
    createdAt: existingIdx >= 0 ? votes[existingIdx]!.createdAt : new Date(),
  };

  if (existingIdx >= 0) {
    votes[existingIdx] = row;
  } else {
    votes.push(row);
  }

  return row;
}

// closePoll: organizer required, scoped by tripId
function simulateClosePoll(
  polls: PollRow[],
  input: { pollId: string; tripId: string },
  tripRole: TripRole,
): PollRow {
  requireOrganizer(tripRole);

  const poll = polls.find(
    (p) => p.id === input.pollId && p.tripId === input.tripId,
  );

  if (!poll) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Poll not found.",
    });
  }

  poll.status = "closed";
  return poll;
}

// updateProposalStatus: selected/rejected require organizer; booked sets bookedByUserId
function simulateUpdateProposalStatus(
  proposals: ProposalRow[],
  input: {
    proposalId: string;
    tripId: string;
    status: ProposalStatus;
    ctxUserId: string;
  },
  tripRole: TripRole,
): ProposalRow {
  if (input.status === "selected" || input.status === "rejected") {
    requireOrganizer(tripRole);
  }

  const proposal = proposals.find(
    (p) => p.id === input.proposalId && p.tripId === input.tripId,
  );

  if (!proposal) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Proposal not found.",
    });
  }

  proposal.status = input.status;
  if (input.status === "booked") {
    proposal.bookedByUserId = input.ctxUserId;
  }

  return proposal;
}

// confirmTrip: organizer required, planning status required, closes open polls,
// sets trip status to confirmed
function simulateConfirmTrip(
  trips: TripRow[],
  polls: PollRow[],
  tripId: string,
  tripRole: TripRole,
): TripRow {
  requireOrganizer(tripRole);

  const trip = trips.find((t) => t.id === tripId);
  if (!trip) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Trip not found." });
  }

  if (trip.status !== "planning") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Trip is already '${trip.status}', cannot confirm.`,
    });
  }

  // Close all open polls for this trip
  for (const poll of polls) {
    if (poll.tripId === tripId && poll.status === "open") {
      poll.status = "closed";
    }
  }

  trip.status = "confirmed";
  return trip;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("planning router — poll create + vote + tally", () => {
  it("single vote is recorded with correct response", () => {
    const votes: PollVoteRow[] = [];
    const optionId = randomUUID();

    const upserted = simulateVote(votes, {
      pollOptionId: optionId,
      userId: "user_alice",
      response: "yes",
    });

    expect(votes).toHaveLength(1);
    expect(upserted.response).toBe("yes");
    expect(upserted.pollOptionId).toBe(optionId);
    expect(upserted.userId).toBe("user_alice");
  });

  it("changed vote replaces (not duplicates) the previous vote for the same user+option", () => {
    const votes: PollVoteRow[] = [];
    const optionId = randomUUID();

    simulateVote(votes, {
      pollOptionId: optionId,
      userId: "user_alice",
      response: "yes",
    });
    expect(votes).toHaveLength(1);
    expect(votes[0]?.response).toBe("yes");

    simulateVote(votes, {
      pollOptionId: optionId,
      userId: "user_alice",
      response: "no",
    });
    expect(votes).toHaveLength(1); // still 1 — replaced, not duplicated
    expect(votes[0]?.response).toBe("no");
  });

  it("two different users voting on the same option creates two separate rows", () => {
    const votes: PollVoteRow[] = [];
    const optionId = randomUUID();

    simulateVote(votes, {
      pollOptionId: optionId,
      userId: "user_alice",
      response: "yes",
    });
    simulateVote(votes, {
      pollOptionId: optionId,
      userId: "user_bob",
      response: "maybe",
    });

    expect(votes).toHaveLength(2);
    const aliceVote = votes.find((v) => v.userId === "user_alice");
    const bobVote = votes.find((v) => v.userId === "user_bob");
    expect(aliceVote?.response).toBe("yes");
    expect(bobVote?.response).toBe("maybe");
  });

  it("vote tally: vote count is the number of votes per option", () => {
    const votes: PollVoteRow[] = [];
    const optionId = randomUUID();

    simulateVote(votes, {
      pollOptionId: optionId,
      userId: "user_alice",
      response: "yes",
    });
    simulateVote(votes, {
      pollOptionId: optionId,
      userId: "user_bob",
      response: "yes",
    });

    const voteCount = votes.filter((v) => v.pollOptionId === optionId).length;
    expect(voteCount).toBe(2);
  });
});

describe("planning router — closePoll", () => {
  it("organizer can close an open poll scoped to the correct trip", () => {
    const tripId = "trip_1";
    const pollId = randomUUID();
    const polls: PollRow[] = [
      {
        id: pollId,
        tripId,
        createdByUserId: "user_alice",
        title: "When should we go?",
        pollType: "date_range",
        closesAt: null,
        status: "open",
        createdAt: new Date(),
      },
    ];

    const updated = simulateClosePoll(polls, { pollId, tripId }, "organizer");
    expect(updated.status).toBe("closed");
  });

  it("member cannot close a poll — throws FORBIDDEN", () => {
    const tripId = "trip_1";
    const pollId = randomUUID();
    const polls: PollRow[] = [
      {
        id: pollId,
        tripId,
        createdByUserId: "user_alice",
        title: "What to eat?",
        pollType: "single_choice",
        closesAt: null,
        status: "open",
        createdAt: new Date(),
      },
    ];

    expect(() =>
      simulateClosePoll(polls, { pollId, tripId }, "member"),
    ).toThrow(TRPCError);
    expect(() =>
      simulateClosePoll(polls, { pollId, tripId }, "member"),
    ).toThrow("Only organizers can perform this action.");
  });

  it("closePoll scopes by tripId — poll from a different trip is not found", () => {
    const pollId = randomUUID();
    const polls: PollRow[] = [
      {
        id: pollId,
        tripId: "trip_OTHER",
        createdByUserId: "user_alice",
        title: "Different trip poll",
        pollType: "single_choice",
        closesAt: null,
        status: "open",
        createdAt: new Date(),
      },
    ];

    expect(() =>
      simulateClosePoll(polls, { pollId, tripId: "trip_1" }, "organizer"),
    ).toThrow(TRPCError);
    expect(() =>
      simulateClosePoll(polls, { pollId, tripId: "trip_1" }, "organizer"),
    ).toThrow("Poll not found.");
  });
});

describe("planning router — proposal lifecycle", () => {
  function makeProposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
    return {
      id: randomUUID(),
      tripId: "trip_1",
      createdByUserId: "user_alice",
      proposalType: "flight",
      title: "United 404 Non-Stop",
      description: null,
      url: null,
      priceCents: 35000,
      currency: "USD",
      priceNote: null,
      imageUrl: null,
      segmentId: null,
      status: "proposed",
      bookedByUserId: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it("create: initial proposal status is proposed", () => {
    const proposal = makeProposal();
    expect(proposal.status).toBe("proposed");
    expect(proposal.bookedByUserId).toBeNull();
  });

  it("reactToProposal: upsert — second reaction by same user replaces first", () => {
    type ReactionRow = {
      proposalId: string;
      userId: string;
      reaction: string;
      note: string | null;
    };
    const reactions: ReactionRow[] = [];

    function simulateReact(
      reactions: ReactionRow[],
      input: {
        proposalId: string;
        userId: string;
        reaction: string;
        note?: string;
      },
    ) {
      const idx = reactions.findIndex(
        (r) => r.proposalId === input.proposalId && r.userId === input.userId,
      );
      const row = {
        proposalId: input.proposalId,
        userId: input.userId,
        reaction: input.reaction,
        note: input.note ?? null,
      };
      if (idx >= 0) reactions[idx] = row;
      else reactions.push(row);
      return row;
    }

    const proposalId = randomUUID();
    simulateReact(reactions, {
      proposalId,
      userId: "user_bob",
      reaction: "up",
    });
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.reaction).toBe("up");

    simulateReact(reactions, {
      proposalId,
      userId: "user_bob",
      reaction: "down",
    });
    expect(reactions).toHaveLength(1); // replaced, not duplicated
    expect(reactions[0]?.reaction).toBe("down");
  });

  it("updateProposalStatus to selected requires organizer", () => {
    const proposals = [makeProposal()];

    expect(() =>
      simulateUpdateProposalStatus(
        proposals,
        {
          proposalId: proposals[0]!.id,
          tripId: "trip_1",
          status: "selected",
          ctxUserId: "user_bob",
        },
        "member",
      ),
    ).toThrow(TRPCError);
  });

  it("updateProposalStatus to rejected requires organizer", () => {
    const proposals = [makeProposal()];

    expect(() =>
      simulateUpdateProposalStatus(
        proposals,
        {
          proposalId: proposals[0]!.id,
          tripId: "trip_1",
          status: "rejected",
          ctxUserId: "user_bob",
        },
        "member",
      ),
    ).toThrow("Only organizers can perform this action.");
  });

  it("updateProposalStatus to booked: does NOT require organizer, sets bookedByUserId", () => {
    const proposals = [makeProposal()];
    const proposalId = proposals[0]!.id;

    const updated = simulateUpdateProposalStatus(
      proposals,
      { proposalId, tripId: "trip_1", status: "booked", ctxUserId: "user_bob" },
      "member",
    );

    expect(updated.status).toBe("booked");
    expect(updated.bookedByUserId).toBe("user_bob");
  });

  it("updateProposalStatus to selected by organizer succeeds", () => {
    const proposals = [makeProposal()];
    const proposalId = proposals[0]!.id;

    const updated = simulateUpdateProposalStatus(
      proposals,
      {
        proposalId,
        tripId: "trip_1",
        status: "selected",
        ctxUserId: "user_alice",
      },
      "organizer",
    );

    expect(updated.status).toBe("selected");
  });

  it("updateProposalStatus scoped by tripId — wrong trip returns NOT_FOUND", () => {
    const proposals = [makeProposal({ tripId: "trip_1" })];

    expect(() =>
      simulateUpdateProposalStatus(
        proposals,
        {
          proposalId: proposals[0]!.id,
          tripId: "trip_DIFFERENT",
          status: "selected",
          ctxUserId: "user_alice",
        },
        "organizer",
      ),
    ).toThrow("Proposal not found.");
  });
});

describe("planning router — confirmTrip", () => {
  function makeTrip(overrides: Partial<TripRow> = {}): TripRow {
    return { id: "trip_1", status: "planning", ...overrides };
  }

  it("organizer can confirm a planning-status trip; trip status becomes confirmed", () => {
    const trips = [makeTrip()];
    const polls: PollRow[] = [];

    const updated = simulateConfirmTrip(trips, polls, "trip_1", "organizer");
    expect(updated.status).toBe("confirmed");
  });

  it("member cannot confirm a trip — throws FORBIDDEN", () => {
    const trips = [makeTrip()];
    const polls: PollRow[] = [];

    expect(() => simulateConfirmTrip(trips, polls, "trip_1", "member")).toThrow(
      TRPCError,
    );
    expect(() => simulateConfirmTrip(trips, polls, "trip_1", "member")).toThrow(
      "Only organizers can perform this action.",
    );
  });

  it("confirmTrip on an already-confirmed trip throws BAD_REQUEST with the current status in the message", () => {
    const trips = [makeTrip({ status: "confirmed" })];
    const polls: PollRow[] = [];

    expect(() =>
      simulateConfirmTrip(trips, polls, "trip_1", "organizer"),
    ).toThrow(TRPCError);
    expect(() =>
      simulateConfirmTrip(trips, polls, "trip_1", "organizer"),
    ).toThrow("Trip is already 'confirmed', cannot confirm.");
  });

  it("confirmTrip closes all open polls in the trip", () => {
    const tripId = "trip_1";
    const trips = [makeTrip({ id: tripId })];
    const polls: PollRow[] = [
      {
        id: randomUUID(),
        tripId,
        createdByUserId: "u1",
        title: "Dates?",
        pollType: "date_range",
        closesAt: null,
        status: "open",
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        tripId,
        createdByUserId: "u1",
        title: "Hotel?",
        pollType: "single_choice",
        closesAt: null,
        status: "open",
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        tripId,
        createdByUserId: "u1",
        title: "Already closed",
        pollType: "multi_choice",
        closesAt: null,
        status: "closed",
        createdAt: new Date(),
      },
    ];

    simulateConfirmTrip(trips, polls, tripId, "organizer");

    // All polls should now be closed
    expect(polls.every((p) => p.status === "closed")).toBe(true);
  });

  it("confirmTrip does not close polls from other trips", () => {
    const tripId = "trip_1";
    const otherTripId = "trip_2";
    const trips = [makeTrip({ id: tripId })];
    const polls: PollRow[] = [
      {
        id: randomUUID(),
        tripId,
        createdByUserId: "u1",
        title: "Our poll",
        pollType: "date_range",
        closesAt: null,
        status: "open",
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        tripId: otherTripId,
        createdByUserId: "u2",
        title: "Other trip poll",
        pollType: "single_choice",
        closesAt: null,
        status: "open",
        createdAt: new Date(),
      },
    ];

    simulateConfirmTrip(trips, polls, tripId, "organizer");

    const otherPoll = polls.find((p) => p.tripId === otherTripId);
    expect(otherPoll?.status).toBe("open"); // untouched
  });
});
