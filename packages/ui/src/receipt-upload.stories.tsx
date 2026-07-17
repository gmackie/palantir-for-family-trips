import { ReceiptUpload } from "./receipt-upload";

const sampleExtracted = {
  merchant: "Corner Cafe",
  currency: "USD",
  subtotalCents: 2850,
  taxCents: 228,
  tipCents: 500,
  totalCents: 3578,
  needsReview: false,
  lineItems: [
    { name: "Avocado toast", quantity: 1, lineTotalCents: 1200 },
    { name: "Pancakes", quantity: 1, lineTotalCents: 950 },
    { name: "Latte", quantity: 1, lineTotalCents: 450 },
    { name: "Orange juice", quantity: 1, lineTotalCents: 250 },
  ],
};

const meta = {
  title: "UI/ReceiptUpload",
  component: ReceiptUpload,
  tags: ["autodocs"],
  args: {
    onFileSelect: (file: File) => {
      console.log("file", file.name);
    },
    onClear: () => {
      console.log("clear");
    },
  },
};

export default meta;

export const Default = {
  args: {
    status: "empty" as const,
  },
};

export const Empty = {
  args: {
    status: "empty" as const,
  },
};

export const Loading = {
  args: {
    status: "loading" as const,
    scanning: true,
  },
};

export const OcrPending = {
  name: "OCR-pending",
  args: {
    status: "loading" as const,
    scanning: true,
    statusNote: "Extracting merchant → totals → line items…",
  },
};

export const Success = {
  args: {
    status: "success" as const,
    extracted: sampleExtracted,
    statusNote: "Scanned 4 items — review and submit.",
  },
};

export const NeedsReview = {
  args: {
    status: "success" as const,
    extracted: {
      ...sampleExtracted,
      needsReview: true,
      warnings: ["Totals did not fully reconcile — double-check tax and tip."],
    },
    statusNote: "Scanned — low confidence, please double-check the amounts.",
  },
};

export const NonUsdCurrency = {
  args: {
    status: "success" as const,
    extracted: {
      ...sampleExtracted,
      currency: "EUR",
      merchant: "Café du Coin",
    },
  },
};

export const Error = {
  args: {
    status: "error" as const,
    error: "Couldn't read the receipt — enter manually.",
  },
};
