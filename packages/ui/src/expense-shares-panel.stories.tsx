import { ExpenseSharesPanel } from "./expense-shares-panel";

const members = [
  { userId: "alice", displayName: "Alice", colorHex: "#58A6FF" },
  { userId: "bob", displayName: "Bob", colorHex: "#3FB950" },
];

const meta = {
  title: "Dashboard/ExpenseSharesPanel",
  component: ExpenseSharesPanel,
  tags: ["autodocs"],
  args: {
    payerUserId: "alice",
    currentUserId: "alice",
    members,
    currency: "USD",
    shares: [
      {
        userId: "alice",
        subtotalCents: 800,
        taxCents: 80,
        tipCents: 160,
        totalCents: 1040,
      },
      {
        userId: "bob",
        subtotalCents: 200,
        taxCents: 20,
        tipCents: 40,
        totalCents: 260,
      },
    ],
    warnings: [],
    payerRoundingAbsorptionCents: 0,
  },
};

export default meta;

export const Default = {};

export const WithRounding = {
  args: {
    payerRoundingAbsorptionCents: 3,
  },
};

export const WithWarnings = {
  args: {
    warnings: [
      "Line item li-2 has no claimants — split equally among trip participants.",
    ],
  },
};

export const Empty = {
  args: {
    shares: [],
  },
};
