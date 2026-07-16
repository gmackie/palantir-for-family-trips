import { GroupModeToggle } from "./group-mode-toggle";

const meta = {
  title: "UI/GroupModeToggle",
  component: GroupModeToggle,
  tags: ["autodocs"],
  args: {
    defaultValue: false,
    disabled: false,
    variant: "cards" as const,
  },
};

export default meta;

export const Default = {};

export const GroupSelected = {
  args: {
    defaultValue: true,
  },
};

export const SwitchVariant = {
  args: {
    variant: "switch" as const,
    defaultValue: true,
  },
};

export const SwitchOff = {
  args: {
    variant: "switch" as const,
    defaultValue: false,
  },
};

export const Disabled = {
  args: {
    disabled: true,
    defaultValue: true,
  },
};
