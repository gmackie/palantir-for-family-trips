import { LineItemRow } from "./line-item-row";

const members = [
  { userId: "alice", displayName: "Alice", colorHex: "#58A6FF" },
  { userId: "bob", displayName: "Bob", colorHex: "#3FB950" },
  { userId: "carol", displayName: "Carol", colorHex: "#D29922" },
];

const meta = {
  title: "Dashboard/LineItemRow",
  component: LineItemRow,
  tags: ["autodocs"],
  args: {
    item: {
      id: "li-1",
      name: "Margherita pizza",
      quantity: 1,
      unitPriceCents: 1800,
      lineTotalCents: 1800,
      claimantUserIds: [],
    },
    members,
    claimMode: "tap" as const,
    currentUserId: "alice",
    isOrganizer: false,
    isDraft: false,
  },
};

export default meta;

export const TapUnclaimed = {};

export const TapClaimed = {
  args: {
    item: {
      id: "li-1",
      name: "Margherita pizza",
      quantity: 1,
      unitPriceCents: 1800,
      lineTotalCents: 1800,
      claimantUserIds: ["alice"],
    },
  },
};

export const TapShared = {
  args: {
    item: {
      id: "li-2",
      name: "Caesar salad",
      quantity: 1,
      unitPriceCents: 1200,
      lineTotalCents: 1200,
      claimantUserIds: ["alice", "bob"],
    },
  },
};

export const OrganizerMode = {
  args: {
    claimMode: "organizer" as const,
    isOrganizer: true,
    item: {
      id: "li-3",
      name: "Tiramisu",
      quantity: 2,
      unitPriceCents: 650,
      lineTotalCents: 1300,
      claimantUserIds: ["bob"],
    },
  },
};

export const Draft = {
  args: {
    isDraft: true,
  },
};

export const Loading = {
  args: {
    pending: true,
  },
};
