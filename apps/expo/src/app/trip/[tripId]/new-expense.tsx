import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

interface OcrResult {
  merchant?: string;
  subtotalCents?: number;
  taxCents?: number;
  tipCents?: number;
  totalCents?: number;
  lineItems?: Array<{
    name: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
}

interface LineItemDraft {
  key: string;
  name: string;
  quantity: number;
  priceDollars: string;
}

const TIP_PRESETS = [
  { label: "15%", multiplier: 0.15 },
  { label: "18%", multiplier: 0.18 },
  { label: "20%", multiplier: 0.2 },
] as const;

const C = {
  bg: "#141116",
  fg: "#f9f7fb",
  muted: "#8c8691",
  card: "#1e1b24",
  border: "#2f2a33",
  input: "#252128",
  primary: "#d66daa",
  primaryFg: "#141116",
  accent: "#58A6FF",
  danger: "#F85149",
} as const;

function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(dollars: string): number {
  const num = Number.parseFloat(dollars);
  return Number.isNaN(num) ? 0 : Math.round(num * 100);
}

function makeKey() {
  return Math.random().toString(36).slice(2);
}

export default function NewExpense() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [receiptMeta, setReceiptMeta] = useState<{
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  } | null>(null);

  const [merchant, setMerchant] = useState("");
  const [subtotalDollars, setSubtotalDollars] = useState("");
  const [taxDollars, setTaxDollars] = useState("");
  const [tipDollars, setTipDollars] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [lineItemDrafts, setLineItemDrafts] = useState<LineItemDraft[]>([]);

  const subtotalCents = dollarsToCents(subtotalDollars);
  const taxCents = dollarsToCents(taxDollars);
  const tipCents = dollarsToCents(tipDollars);
  const totalCents = subtotalCents + taxCents + tipCents;

  const { data: segments } = useQuery(
    trpc.trips.listSegments.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const createExpense = useMutation(
    trpc.expenses.create.mutationOptions({
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const attachReceiptMutation = useMutation(
    trpc.expenses.attachReceiptImage.mutationOptions({}),
  );

  const addLineItemsMutation = useMutation(
    trpc.expenses.addLineItems.mutationOptions({
      onError: (err) => Alert.alert("Error", `Line items: ${err.message}`),
    }),
  );

  const handleTakePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Camera access is required to take receipt photos.",
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      void uploadReceipt(result.assets[0].uri);
    }
  };

  const handlePickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      void uploadReceipt(result.assets[0].uri);
    }
  };

  const uploadReceipt = async (uri: string) => {
    setUploading(true);
    try {
      const formData = new FormData();
      const filename = uri.split("/").pop() ?? "receipt.jpg";
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : "image/jpeg";

      formData.append("file", {
        uri,
        name: filename,
        type,
      } as unknown as Blob);

      const cookies = authClient.getCookie();
      const headers: Record<string, string> = {
        "Content-Type": "multipart/form-data",
      };
      if (cookies) {
        headers.Cookie = cookies;
      }

      const response = await fetch(`${getBaseUrl()}/api/receipts/upload`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (response.ok) {
        const data = (await response.json()) as {
          storageKey?: string;
          mimeType?: string;
          sizeBytes?: number;
          ocr?: OcrResult;
        };
        if (data.storageKey && data.mimeType && data.sizeBytes) {
          setReceiptMeta({
            storageKey: data.storageKey,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
          });
        }
        const ocr = data.ocr;
        if (ocr) {
          if (ocr.merchant) setMerchant(ocr.merchant);
          if (ocr.subtotalCents != null)
            setSubtotalDollars(centsToDisplay(ocr.subtotalCents));
          if (ocr.taxCents != null) setTaxDollars(centsToDisplay(ocr.taxCents));
          if (ocr.lineItems && ocr.lineItems.length > 0) {
            setLineItemDrafts(
              ocr.lineItems.map((item) => ({
                key: makeKey(),
                name: item.name,
                quantity: item.quantity,
                priceDollars: centsToDisplay(item.lineTotalCents),
              })),
            );
          }
        }
      }
    } catch (err) {
      console.error("Upload failed:", err);
      Alert.alert(
        "Upload Error",
        "Failed to upload receipt. You can still enter details manually.",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleTipPreset = useCallback(
    (index: number) => {
      if (selectedPreset === index) {
        setSelectedPreset(null);
        setTipDollars("");
        return;
      }
      setSelectedPreset(index);
      const tip = subtotalCents * TIP_PRESETS[index]!.multiplier;
      setTipDollars((Math.round(tip) / 100).toFixed(2));
    },
    [subtotalCents, selectedPreset],
  );

  const updateLineItem = useCallback(
    (key: string, field: keyof LineItemDraft, value: string | number) => {
      setLineItemDrafts((prev) =>
        prev.map((item) =>
          item.key === key ? { ...item, [field]: value } : item,
        ),
      );
    },
    [],
  );

  const removeLineItem = useCallback((key: string) => {
    setLineItemDrafts((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const addEmptyLineItem = useCallback(() => {
    setLineItemDrafts((prev) => [
      ...prev,
      { key: makeKey(), name: "", quantity: 1, priceDollars: "" },
    ]);
  }, []);

  const recalcSubtotalFromItems = useCallback(() => {
    if (lineItemDrafts.length === 0) return;
    const sum = lineItemDrafts.reduce(
      (acc, item) => acc + dollarsToCents(item.priceDollars) * item.quantity,
      0,
    );
    setSubtotalDollars(centsToDisplay(sum));
    setSelectedPreset(null);
  }, [lineItemDrafts]);

  const handleSubmit = async () => {
    const segmentId = segments?.[0]?.id;
    if (!segmentId) {
      Alert.alert("Error", "No trip segment found.");
      return;
    }
    if (!merchant.trim()) {
      Alert.alert("Error", "Merchant name is required.");
      return;
    }

    try {
      const created = await createExpense.mutateAsync({
        workspaceId,
        tripId: tripId ?? "",
        segmentId,
        merchant: merchant.trim(),
        occurredAt: new Date().toISOString(),
        subtotalCents,
        taxCents,
        tipCents,
        totalCents,
      });

      if (receiptMeta && created?.id) {
        await attachReceiptMutation.mutateAsync({
          workspaceId,
          tripId: tripId ?? "",
          expenseId: created.id,
          ...receiptMeta,
        });
      }

      if (lineItemDrafts.length > 0 && created?.id) {
        const validItems = lineItemDrafts.filter(
          (item) => item.name.trim() && dollarsToCents(item.priceDollars) > 0,
        );
        if (validItems.length > 0) {
          await addLineItemsMutation.mutateAsync({
            workspaceId,
            tripId: tripId ?? "",
            expenseId: created.id,
            items: validItems.map((item, i) => ({
              name: item.name.trim(),
              quantity: item.quantity,
              unitPriceCents: dollarsToCents(item.priceDollars),
              lineTotalCents: dollarsToCents(item.priceDollars) * item.quantity,
              sortOrder: i,
            })),
          });
        }
      }

      await queryClient.invalidateQueries(trpc.expenses.list.queryFilter());
      router.back();
    } catch {
      // errors handled by mutation onError
    }
  };

  const isPending = createExpense.isPending || addLineItemsMutation.isPending;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "New Expense",
          headerStyle: { backgroundColor: "#0A0C10" },
          headerTintColor: "#C9D1D9",
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Receipt capture */}
          <View style={{ marginBottom: 20 }}>
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 8,
              }}
            >
              Receipt
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                onPress={() => void handleTakePhoto()}
                style={{
                  flex: 1,
                  alignItems: "center",
                  backgroundColor: C.primary,
                  borderRadius: 6,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  minHeight: 48,
                }}
              >
                <Text style={{ color: C.primaryFg, fontWeight: "500" }}>
                  Camera
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void handlePickPhoto()}
                style={{
                  flex: 1,
                  alignItems: "center",
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: C.border,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  minHeight: 48,
                }}
              >
                <Text style={{ color: C.fg, fontWeight: "500" }}>Library</Text>
              </Pressable>
            </View>

            {uploading && (
              <View
                style={{
                  marginTop: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={{ color: C.muted, fontSize: 14 }}>
                  Scanning receipt...
                </Text>
              </View>
            )}

            {photoUri && !uploading && (
              <Pressable onPress={() => void handleTakePhoto()}>
                <Image
                  source={{ uri: photoUri }}
                  style={{
                    marginTop: 12,
                    height: 160,
                    width: "100%",
                    borderRadius: 8,
                  }}
                  resizeMode="cover"
                />
                <Text
                  style={{
                    color: C.muted,
                    fontSize: 12,
                    textAlign: "center",
                    marginTop: 4,
                  }}
                >
                  Tap to retake
                </Text>
              </Pressable>
            )}
          </View>

          {/* Merchant */}
          <View style={{ marginBottom: 16 }}>
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 4,
              }}
            >
              Merchant
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: C.border,
                backgroundColor: C.input,
                color: C.fg,
                borderRadius: 6,
                paddingHorizontal: 12,
                paddingVertical: 12,
                fontSize: 16,
              }}
              value={merchant}
              onChangeText={setMerchant}
              placeholder="Restaurant, store, etc."
              placeholderTextColor="#555"
            />
          </View>

          {/* Line Items */}
          <View style={{ marginBottom: 16 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <Text
                style={{
                  color: C.muted,
                  fontSize: 11,
                  fontWeight: "600",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Line Items
              </Text>
              {lineItemDrafts.length > 0 && (
                <Pressable onPress={recalcSubtotalFromItems}>
                  <Text style={{ color: C.accent, fontSize: 12 }}>
                    Recalc Subtotal
                  </Text>
                </Pressable>
              )}
            </View>

            {lineItemDrafts.map((item) => (
              <View
                key={item.key}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.card,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  marginBottom: 8,
                }}
              >
                <TextInput
                  style={{ flex: 1, color: C.fg, fontSize: 14 }}
                  value={item.name}
                  onChangeText={(v) => updateLineItem(item.key, "name", v)}
                  placeholder="Item name"
                  placeholderTextColor="#555"
                />
                <Text style={{ color: C.muted, fontSize: 14 }}>$</Text>
                <TextInput
                  style={{
                    width: 80,
                    color: C.fg,
                    textAlign: "right",
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    fontSize: 14,
                  }}
                  value={item.priceDollars}
                  onChangeText={(v) =>
                    updateLineItem(item.key, "priceDollars", v)
                  }
                  placeholder="0.00"
                  placeholderTextColor="#555"
                  keyboardType="decimal-pad"
                />
                <Pressable
                  onPress={() => removeLineItem(item.key)}
                  style={{
                    marginLeft: 4,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    minHeight: 32,
                    minWidth: 32,
                  }}
                >
                  <Text style={{ color: C.danger, fontSize: 18 }}>×</Text>
                </Pressable>
              </View>
            ))}

            <Pressable
              onPress={addEmptyLineItem}
              style={{
                alignItems: "center",
                borderRadius: 6,
                borderWidth: 1,
                borderColor: C.border,
                borderStyle: "dashed",
                paddingHorizontal: 12,
                paddingVertical: 12,
                minHeight: 44,
              }}
            >
              <Text style={{ color: C.muted, fontSize: 14 }}>+ Add Item</Text>
            </Pressable>
          </View>

          {/* Totals */}
          <View style={{ marginBottom: 16 }}>
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 8,
              }}
            >
              Totals
            </Text>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>
                  Subtotal
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.input,
                    borderRadius: 6,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: C.muted, fontSize: 16 }}>$</Text>
                  <TextInput
                    style={{
                      flex: 1,
                      color: C.fg,
                      paddingVertical: 12,
                      textAlign: "right",
                      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                      fontSize: 16,
                    }}
                    value={subtotalDollars}
                    onChangeText={(v) => {
                      setSubtotalDollars(v);
                      setSelectedPreset(null);
                    }}
                    placeholder="0.00"
                    placeholderTextColor="#555"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>
                  Tax
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.input,
                    borderRadius: 6,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: C.muted, fontSize: 16 }}>$</Text>
                  <TextInput
                    style={{
                      flex: 1,
                      color: C.fg,
                      paddingVertical: 12,
                      textAlign: "right",
                      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                      fontSize: 16,
                    }}
                    value={taxDollars}
                    onChangeText={setTaxDollars}
                    placeholder="0.00"
                    placeholderTextColor="#555"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Tip picker */}
          <View style={{ marginBottom: 16 }}>
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 8,
              }}
            >
              Tip
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              {TIP_PRESETS.map((preset, i) => (
                <Pressable
                  key={preset.label}
                  onPress={() => handleTipPreset(i)}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    borderRadius: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    minHeight: 44,
                    ...(selectedPreset === i
                      ? { backgroundColor: C.primary }
                      : { borderWidth: 1, borderColor: C.border }),
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "500",
                      color: selectedPreset === i ? C.primaryFg : C.fg,
                    }}
                  >
                    {preset.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1,
                borderColor: C.border,
                backgroundColor: C.input,
                borderRadius: 6,
                paddingHorizontal: 12,
              }}
            >
              <Text style={{ color: C.muted, fontSize: 16 }}>$</Text>
              <TextInput
                style={{
                  flex: 1,
                  color: C.fg,
                  paddingVertical: 12,
                  textAlign: "right",
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                  fontSize: 16,
                }}
                value={tipDollars}
                onChangeText={(v) => {
                  setTipDollars(v);
                  setSelectedPreset(null);
                }}
                placeholder="0.00"
                placeholderTextColor="#555"
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          {/* Total display */}
          <View
            style={{
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.card,
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: C.fg, fontSize: 18, fontWeight: "600" }}>
                Total
              </Text>
              <Text
                style={{
                  color: C.fg,
                  fontSize: 24,
                  fontWeight: "bold",
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                }}
              >
                ${centsToDisplay(totalCents)}
              </Text>
            </View>
          </View>

          {/* Submit */}
          <Pressable
            onPress={() => void handleSubmit()}
            disabled={isPending}
            style={{
              backgroundColor: C.primary,
              alignItems: "center",
              borderRadius: 6,
              paddingHorizontal: 16,
              paddingVertical: 16,
              marginBottom: 40,
              minHeight: 48,
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                style={{ color: C.primaryFg, fontSize: 16, fontWeight: "600" }}
              >
                Save Expense
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
