import { FerryInputForm } from "./ferry-input-form";

const meta = {
  title: "UI/FerryInputForm",
  component: FerryInputForm,
  tags: ["autodocs"],
  args: {
    onExtract: (file: File) => {
      console.log("extract", file.name);
    },
    onSubmit: (values: unknown) => {
      console.log("submit", values);
    },
  },
};

export default meta;

export const Default = {};

export const Loading = {
  args: {
    extracting: true,
  },
};

export const Prefilled = {
  args: {
    extracted: {
      operator: "Washington State Ferries",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      departureAt: "2026-07-09T14:05:00",
      fareCents: 1675,
      currency: "USD",
      vehicleReservation: true,
      confirmationNumber: "WSF-12345",
    },
  },
};
