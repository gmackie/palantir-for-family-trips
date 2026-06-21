import { FerryLegCard } from "./ferry-leg-card";

const meta = {
  title: "UI/FerryLegCard",
  component: FerryLegCard,
  tags: ["autodocs"],
  args: {
    operator: "Washington State Ferries",
    departureTerminal: "Edmonds",
    arrivalTerminal: "Kingston",
    scheduledDepartureAt: new Date("2026-07-09T14:05:00"),
    durationMinutes: 30,
    fareCents: 1675,
    currency: "USD",
    vehicleReservation: true,
    confirmationNumber: "WSF-12345",
    ferry: {
      leaveBy: new Date("2026-07-09T12:20:00"),
      nonDrivableMinutes: 60,
    },
  },
};

export default meta;

export const Default = {};

export const Empty = {
  args: {
    fareCents: null,
    confirmationNumber: null,
    vehicleReservation: false,
    ferry: null,
  },
};

export const Loading = {
  args: {
    loading: true,
  },
};
