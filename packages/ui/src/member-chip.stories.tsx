import { MemberChip } from "./member-chip";

const meta = {
  title: "Dashboard/MemberChip",
  component: MemberChip,
  tags: ["autodocs"],
  args: {
    member: {
      userId: "user-alice",
      displayName: "Alice",
      colorHex: "#58A6FF",
    },
  },
};

export default meta;

export const Default = {};

export const You = {
  args: {
    label: "You",
    member: {
      userId: "user-bob",
      displayName: "Bob",
      colorHex: "#3FB950",
    },
  },
};

export const FallbackColor = {
  args: {
    member: {
      userId: "user-unknown",
      displayName: null,
      colorHex: null,
    },
  },
};
