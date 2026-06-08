import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { C, mono, R } from "~/utils/design";
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
  { label: "None", multiplier: 0 },
  { label: "15%", multiplier: 0.15 },
  { label: "18%", multiplier: 0.18 },
  { label: "20%", multiplier: 0.2 },
] as const;

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
  const { tripId, type } = useLocalSearchParams<{
    tripId: string;
    type?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrApplied, setOcrApplied] = useState(false);
  const [receiptMeta, setReceiptMeta] = useState<{
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  } | null>(null);

  const expenseType = type === "gas" ? "gas" : "regular";
  const [merchant, setMerchant] = useState("");
  const [subtotalDollars, setSubtotalDollars] = useState("");
  const [taxDollars, setTaxDollars] = useState("");
  const [tipDollars, setTipDollars] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [lineItemDrafts, setLineItemDrafts] = useState<LineItemDraft[]>([]);
  const [gallons, setGallons] = useState("");
  const [pricePerGallon, setPricePerGallon] = useState("");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  const [currency, setCurrency] = useState("USD");
  // Gas fill-ups default to splitting evenly across the group.
  const [splitWithGroup, setSplitWithGroup] = useState(true);

  const subtotalCents = dollarsToCents(subtotalDollars);
  const taxCents = expenseType === "gas" ? 0 : dollarsToCents(taxDollars);
  const tipCents = expenseType === "gas" ? 0 : dollarsToCents(tipDollars);
  const totalCents = subtotalCents + taxCents + tipCents;

  const { data: segments } = useQuery(
    trpc.trips.listSegments.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  useEffect(() => {
    if (!selectedSegmentId && segments && segments.length > 0) {
      setSelectedSegmentId(segments[0]!.id);
    }
  }, [segments, selectedSegmentId]);

  const createExpense = useMutation(
    trpc.expenses.create.mutationOptions({
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const createFuelLog = useMutation(
    trpc.fuelLogs.create.mutationOptions({
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
      exif: false,
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
      exif: false,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      void uploadReceipt(result.assets[0].uri);
    }
  };

  const uploadReceipt = async (uri: string) => {
    setUploading(true);
    setOcrApplied(false);
    try {
      const resized = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      const finalUri = resized.uri;
      const filename = "receipt.jpg";
      const type = "image/jpeg";

      const cookies = authClient.getCookie();
      const uploadUrl = `${getBaseUrl()}/api/receipts/scan`;

      const response = await new Promise<{
        ok: boolean;
        status: number;
        text: string;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl);
        if (cookies) xhr.setRequestHeader("Cookie", cookies);
        xhr.onload = () => {
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            text: xhr.responseText,
          });
        };
        xhr.onerror = () =>
          reject(new Error(`XHR network error, status=${xhr.status}`));

        const formData = new FormData();
        formData.append("file", {
          uri: finalUri,
          name: filename,
          type,
        } as unknown as Blob);
        xhr.send(formData);
      });

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(response.text);
      } catch {
        Alert.alert(
          "Upload Error",
          `Server returned ${response.status}: ${response.text.substring(0, 200)}`,
        );
        return;
      }

      if (!response.ok) {
        Alert.alert(
          "Upload Error",
          (data.error as string) ?? `Server returned ${response.status}`,
        );
        return;
      }

      if (data.storageKey && data.mimeType && data.sizeBytes) {
        setReceiptMeta({
          storageKey: data.storageKey as string,
          mimeType: data.mimeType as string,
          sizeBytes: data.sizeBytes as number,
        });
      }

      if (data.ocrError) {
        Alert.alert("OCR Failed", `${data.ocrError}`);
        return;
      }

      const ocr = data.ocr as OcrResult | null | undefined;
      if (!ocr) {
        Alert.alert(
          "No OCR Data",
          "Could not read the receipt. You can still enter details manually.",
        );
        return;
      }

      const itemCount = ocr.lineItems?.length ?? 0;
      if (ocr.merchant) setMerchant(ocr.merchant);

      if (expenseType === "gas") {
        const fuelItem = ocr.lineItems?.find((item) =>
          /\b(gal|gallon|fuel|gas|diesel|unleaded|regular|premium|super)\b/i.test(
            item.name,
          ),
        );
        if (fuelItem && fuelItem.unitPriceCents > 0) {
          setPricePerGallon(centsToDisplay(fuelItem.unitPriceCents));
          const totalForFuel =
            fuelItem.lineTotalCents || (ocr.subtotalCents ?? 0);
          if (totalForFuel > 0) {
            const computedGallons = totalForFuel / fuelItem.unitPriceCents;
            setGallons(computedGallons.toFixed(3));
          }
        }
      }

      if (ocr.taxCents != null)
        setTaxDollars(centsToDisplay(Math.round(ocr.taxCents)));
      if (ocr.lineItems && ocr.lineItems.length > 0) {
        setLineItemDrafts(
          ocr.lineItems.map((item) => ({
            key: makeKey(),
            name: item.name,
            quantity: item.quantity,
            priceDollars: centsToDisplay(item.lineTotalCents),
          })),
        );
        const itemsSum = ocr.lineItems.reduce(
          (sum, item) => sum + (item.lineTotalCents ?? 0),
          0,
        );
        if (itemsSum > 0) {
          setSubtotalDollars(centsToDisplay(itemsSum));
        } else if (ocr.subtotalCents != null) {
          setSubtotalDollars(centsToDisplay(Math.round(ocr.subtotalCents)));
        }
      } else if (ocr.subtotalCents != null) {
        setSubtotalDollars(centsToDisplay(Math.round(ocr.subtotalCents)));
      }

      if (itemCount > 0 || ocr.merchant) {
        setOcrApplied(true);
      } else {
        Alert.alert(
          "No Items Detected",
          "Could not find line items on the receipt. You can enter them manually below.",
        );
      }
    } catch (err) {
      Alert.alert(
        "Upload Error",
        `${err instanceof Error ? err.message : String(err)}`,
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

  useEffect(() => {
    if (lineItemDrafts.length === 0) return;
    const sum = lineItemDrafts.reduce(
      (acc, item) => acc + dollarsToCents(item.priceDollars) * item.quantity,
      0,
    );
    if (sum > 0) {
      setSubtotalDollars(centsToDisplay(sum));
    }
  }, [lineItemDrafts]);

  const handleSubmit = async () => {
    if (!selectedSegmentId) {
      Alert.alert("Missing info", "Please select a trip segment.");
      return;
    }
    if (!merchant.trim()) {
      Alert.alert("Missing info", "Please enter a merchant name.");
      return;
    }

    try {
      // Gas fill-ups are recorded as fuel logs. When "Split with group" is on,
      // the backend also creates an equal-split group expense and links it
      // back to the fuel log via `expenseId`.
      if (expenseType === "gas") {
        const gal = Number.parseFloat(gallons);
        const ppg = Number.parseFloat(pricePerGallon);
        if (Number.isNaN(gal) || gal <= 0 || Number.isNaN(ppg) || ppg <= 0) {
          Alert.alert("Missing info", "Enter gallons and price per gallon.");
          return;
        }
        await createFuelLog.mutateAsync({
          workspaceId,
          tripId: tripId ?? "",
          segmentId: selectedSegmentId ?? undefined,
          gallons: gal,
          pricePerGallon: ppg,
          totalCents,
          stationName: merchant.trim(),
          loggedAt: new Date().toISOString(),
          currency,
          splitWithGroup,
        });

        await queryClient.invalidateQueries(trpc.expenses.list.queryFilter());
        router.back();
        return;
      }

      const created = await createExpense.mutateAsync({
        workspaceId,
        tripId: tripId ?? "",
        segmentId: selectedSegmentId,
        merchant: merchant.trim(),
        occurredAt: new Date().toISOString(),
        subtotalCents,
        taxCents,
        tipCents,
        totalCents,
        currency,
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
              lineTotalCents: Math.round(
                dollarsToCents(item.priceDollars) * item.quantity,
              ),
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

  const isPending =
    createExpense.isPending ||
    createFuelLog.isPending ||
    addLineItemsMutation.isPending;

  const hasMultipleSegments = (segments?.length ?? 0) > 1;
  const selectedSegment = segments?.find((s) => s.id === selectedSegmentId);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: expenseType === "gas" ? "Gas Fill-Up" : "New Expense",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
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
          {/* Hero receipt capture */}
          {!photoUri && !uploading && (
            <View style={{ marginBottom: 24 }}>
              <Pressable
                onPress={() => void handleTakePhoto()}
                style={{
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: R.md,
                  paddingVertical: 32,
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Ionicons name="camera-outline" size={36} color={C.info} />
                <Text style={{ color: C.fg, fontSize: 16, fontWeight: "600" }}>
                  Scan Receipt
                </Text>
                <Text style={{ color: C.muted, fontSize: 13 }}>
                  Auto-fills merchant, items, and totals
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void handlePickPhoto()}
                style={{
                  marginTop: 8,
                  paddingVertical: 10,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: C.muted, fontSize: 13 }}>
                  or choose from photo library
                </Text>
              </Pressable>
            </View>
          )}

          {uploading && (
            <View
              style={{
                backgroundColor: C.surface,
                borderWidth: 1,
                borderColor: C.info,
                borderRadius: R.md,
                padding: 24,
                alignItems: "center",
                gap: 12,
                marginBottom: 24,
              }}
            >
              <ActivityIndicator size="large" color={C.info} />
              <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
                Reading receipt...
              </Text>
              <Text style={{ color: C.muted, fontSize: 13 }}>
                This takes a few seconds
              </Text>
            </View>
          )}

          {photoUri && !uploading && (
            <View style={{ marginBottom: 20 }}>
              <Pressable onPress={() => void handleTakePhoto()}>
                <Image
                  source={{ uri: photoUri }}
                  style={{
                    height: 120,
                    width: "100%",
                    borderRadius: R.md,
                  }}
                  resizeMode="cover"
                />
                {ocrApplied && (
                  <View
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      backgroundColor: C.successBg,
                      borderRadius: R.md,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={14}
                      color={C.success}
                    />
                    <Text
                      style={{
                        color: C.success,
                        fontSize: 11,
                        fontWeight: "600",
                      }}
                    >
                      Scanned
                    </Text>
                  </View>
                )}
              </Pressable>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 16,
                  marginTop: 8,
                }}
              >
                <Pressable
                  onPress={() => void handleTakePhoto()}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingVertical: 4,
                  }}
                >
                  <Ionicons name="camera-outline" size={14} color={C.muted} />
                  <Text style={{ color: C.muted, fontSize: 12 }}>Retake</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handlePickPhoto()}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingVertical: 4,
                  }}
                >
                  <Ionicons name="images-outline" size={14} color={C.muted} />
                  <Text style={{ color: C.muted, fontSize: 12 }}>Library</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Segment picker */}
          {hasMultipleSegments && segments && (
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
                Trip Segment
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -4 }}
              >
                {segments.map((seg) => {
                  const active = seg.id === selectedSegmentId;
                  return (
                    <Pressable
                      key={seg.id}
                      onPress={() => setSelectedSegmentId(seg.id)}
                      style={{
                        marginHorizontal: 4,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: R.md,
                        minHeight: 44,
                        justifyContent: "center",
                        ...(active
                          ? { backgroundColor: C.info }
                          : {
                              borderWidth: 1,
                              borderColor: C.border,
                              backgroundColor: C.surface,
                            }),
                      }}
                    >
                      <Text
                        style={{
                          color: active ? C.white : C.fg,
                          fontSize: 14,
                          fontWeight: "600",
                        }}
                        numberOfLines={1}
                      >
                        {seg.name}
                      </Text>
                      {seg.startDate && (
                        <Text
                          style={{
                            color: active ? "rgba(255,255,255,0.7)" : C.muted,
                            fontSize: 11,
                          }}
                        >
                          {seg.startDate}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

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
                borderColor: merchant ? C.border : C.border,
                backgroundColor: C.input,
                color: C.fg,
                borderRadius: R.md,
                paddingHorizontal: 12,
                paddingVertical: 12,
                fontSize: 16,
              }}
              value={merchant}
              onChangeText={setMerchant}
              placeholder="Restaurant, store, gas station..."
              placeholderTextColor={C.placeholder}
            />
          </View>

          {/* Gas details */}
          {expenseType === "gas" && (
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
                Fuel
              </Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}
                  >
                    Gallons
                  </Text>
                  <TextInput
                    style={{
                      borderWidth: 1,
                      borderColor: C.border,
                      backgroundColor: C.input,
                      color: C.fg,
                      borderRadius: R.md,
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      fontSize: 16,
                      fontFamily: mono,
                      textAlign: "right",
                    }}
                    value={gallons}
                    onChangeText={(v) => {
                      setGallons(v);
                      const gal = Number.parseFloat(v);
                      const ppg = Number.parseFloat(pricePerGallon);
                      if (!Number.isNaN(gal) && !Number.isNaN(ppg)) {
                        setSubtotalDollars((gal * ppg).toFixed(2));
                      }
                    }}
                    placeholder="0.000"
                    placeholderTextColor={C.placeholder}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}
                  >
                    $/gallon
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: C.border,
                      backgroundColor: C.input,
                      borderRadius: R.md,
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
                        fontFamily: mono,
                        fontSize: 16,
                      }}
                      value={pricePerGallon}
                      onChangeText={(v) => {
                        setPricePerGallon(v);
                        const gal = Number.parseFloat(gallons);
                        const ppg = Number.parseFloat(v);
                        if (!Number.isNaN(gal) && !Number.isNaN(ppg)) {
                          setSubtotalDollars((gal * ppg).toFixed(2));
                        }
                      }}
                      placeholder="0.000"
                      placeholderTextColor={C.placeholder}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Split with group (gas only) */}
          {expenseType === "gas" && (
            <Pressable
              onPress={() => setSplitWithGroup((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: splitWithGroup }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: 44,
                marginBottom: 16,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor: splitWithGroup ? C.success : C.border,
                backgroundColor: splitWithGroup ? C.successBg : C.input,
                borderRadius: R.md,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: R.sm,
                  borderWidth: 1.5,
                  borderColor: splitWithGroup ? C.success : C.muted,
                  backgroundColor: splitWithGroup ? C.success : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {splitWithGroup && (
                  <Ionicons name="checkmark" size={16} color={C.bg} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: C.fg,
                    fontSize: 14,
                    fontWeight: "600",
                  }}
                >
                  Split with group
                </Text>
                <Text style={{ color: C.muted, fontSize: 12 }}>
                  Record an even-split group expense for this fill-up
                </Text>
              </View>
              {splitWithGroup && (
                <Text
                  style={{
                    color: C.success,
                    fontSize: 11,
                    fontWeight: "700",
                    letterSpacing: 1,
                  }}
                >
                  SPLIT
                </Text>
              )}
            </Pressable>
          )}

          {/* Line Items (non-gas only) */}
          {expenseType !== "gas" && (
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
                Line Items
                {lineItemDrafts.length > 0 && (
                  <Text style={{ color: C.muted, fontWeight: "400" }}>
                    {" "}
                    ({lineItemDrafts.length})
                  </Text>
                )}
              </Text>

              {lineItemDrafts.map((item) => (
                <View
                  key={item.key}
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.surface,
                    borderRadius: R.md,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    marginBottom: 8,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <TextInput
                      style={{ flex: 1, color: C.fg, fontSize: 14 }}
                      value={item.name}
                      onChangeText={(v) => updateLineItem(item.key, "name", v)}
                      placeholder="Item name"
                      placeholderTextColor={C.placeholder}
                    />
                    <Text style={{ color: C.muted, fontSize: 14 }}>$</Text>
                    <TextInput
                      style={{
                        width: 80,
                        color: C.fg,
                        textAlign: "right",
                        fontFamily: mono,
                        fontSize: 14,
                      }}
                      value={item.priceDollars}
                      onChangeText={(v) =>
                        updateLineItem(item.key, "priceDollars", v)
                      }
                      placeholder="0.00"
                      placeholderTextColor={C.placeholder}
                      keyboardType="decimal-pad"
                    />
                    <Pressable
                      onPress={() => removeLineItem(item.key)}
                      style={{
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 44,
                        minWidth: 36,
                      }}
                    >
                      <Ionicons name="close-circle" size={18} color={C.muted} />
                    </Pressable>
                  </View>
                  {item.quantity > 1 && (
                    <Text
                      style={{
                        color: C.muted,
                        fontSize: 12,
                        marginTop: 2,
                        fontFamily: mono,
                      }}
                    >
                      qty {item.quantity}
                    </Text>
                  )}
                </View>
              ))}

              <Pressable
                onPress={addEmptyLineItem}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderStyle: "dashed",
                  paddingVertical: 12,
                  minHeight: 44,
                }}
              >
                <Ionicons name="add-circle-outline" size={16} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 14 }}>Add Item</Text>
              </Pressable>
            </View>
          )}

          {/* Currency */}
          <View style={{ marginBottom: 12 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -4 }}
            >
              {(["USD", "EUR", "GBP", "CAD", "AUD", "MXN", "JPY"] as const).map(
                (c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCurrency(c)}
                    style={{
                      marginHorizontal: 4,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: R.md,
                      minHeight: 32,
                      justifyContent: "center",
                      ...(currency === c
                        ? { backgroundColor: C.info }
                        : { borderWidth: 1, borderColor: C.border }),
                    }}
                  >
                    <Text
                      style={{
                        color: currency === c ? C.white : C.muted,
                        fontSize: 12,
                        fontWeight: "600",
                        fontFamily: mono,
                      }}
                    >
                      {c}
                    </Text>
                  </Pressable>
                ),
              )}
            </ScrollView>
          </View>

          {/* Subtotal + Tax (non-gas) */}
          {expenseType !== "gas" && (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
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
                    Subtotal
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: C.border,
                      backgroundColor: C.input,
                      borderRadius: R.md,
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
                        fontFamily: mono,
                        fontSize: 16,
                      }}
                      value={subtotalDollars}
                      onChangeText={(v) => {
                        setSubtotalDollars(v);
                        setSelectedPreset(null);
                      }}
                      placeholder="0.00"
                      placeholderTextColor={C.placeholder}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
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
                    Tax
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: C.border,
                      backgroundColor: C.input,
                      borderRadius: R.md,
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
                        fontFamily: mono,
                        fontSize: 16,
                      }}
                      value={taxDollars}
                      onChangeText={setTaxDollars}
                      placeholder="0.00"
                      placeholderTextColor={C.placeholder}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Tip picker (non-gas only) */}
          {expenseType !== "gas" && (
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
                      borderRadius: R.md,
                      paddingHorizontal: 8,
                      paddingVertical: 12,
                      minHeight: 44,
                      ...(selectedPreset === i
                        ? { backgroundColor: C.info }
                        : { borderWidth: 1, borderColor: C.border }),
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: "500",
                        fontSize: 14,
                        color: selectedPreset === i ? C.white : C.fg,
                      }}
                    >
                      {preset.label}
                    </Text>
                    {selectedPreset === i && tipCents > 0 && (
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.7)",
                          fontSize: 11,
                          fontFamily: mono,
                          marginTop: 2,
                        }}
                      >
                        ${centsToDisplay(tipCents)}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
              {selectedPreset === null && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.input,
                    borderRadius: R.md,
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
                      fontFamily: mono,
                      fontSize: 16,
                    }}
                    value={tipDollars}
                    onChangeText={(v) => {
                      setTipDollars(v);
                      setSelectedPreset(null);
                    }}
                    placeholder="Custom tip amount"
                    placeholderTextColor={C.placeholder}
                    keyboardType="decimal-pad"
                  />
                </View>
              )}
            </View>
          )}

          {/* Total breakdown */}
          <View
            style={{
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.surface,
              borderRadius: R.md,
              padding: 16,
              marginBottom: 20,
              gap: 8,
            }}
          >
            {expenseType !== "gas" && subtotalCents > 0 && (
              <>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ color: C.muted, fontSize: 14 }}>Subtotal</Text>
                  <Text
                    style={{
                      color: C.muted,
                      fontSize: 14,
                      fontFamily: mono,
                    }}
                  >
                    ${centsToDisplay(subtotalCents)}
                  </Text>
                </View>
                {taxCents > 0 && (
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ color: C.muted, fontSize: 14 }}>Tax</Text>
                    <Text
                      style={{
                        color: C.muted,
                        fontSize: 14,
                        fontFamily: mono,
                      }}
                    >
                      ${centsToDisplay(taxCents)}
                    </Text>
                  </View>
                )}
                {tipCents > 0 && (
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ color: C.muted, fontSize: 14 }}>Tip</Text>
                    <Text
                      style={{
                        color: C.muted,
                        fontSize: 14,
                        fontFamily: mono,
                      }}
                    >
                      ${centsToDisplay(tipCents)}
                    </Text>
                  </View>
                )}
                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: C.border,
                    paddingTop: 8,
                  }}
                />
              </>
            )}
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
                  fontFamily: mono,
                }}
              >
                ${centsToDisplay(totalCents)}
              </Text>
            </View>
            {selectedSegment && hasMultipleSegments && (
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                Filed under {selectedSegment.name}
              </Text>
            )}
          </View>

          {/* Submit */}
          <Pressable
            onPress={() => void handleSubmit()}
            disabled={isPending || !merchant.trim() || totalCents === 0}
            style={{
              backgroundColor: C.info,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderRadius: R.md,
              paddingVertical: 16,
              marginBottom: 40,
              minHeight: 52,
              opacity:
                isPending || !merchant.trim() || totalCents === 0 ? 0.5 : 1,
            }}
          >
            {isPending ? (
              <>
                <ActivityIndicator color={C.white} />
                <Text
                  style={{ color: C.white, fontSize: 16, fontWeight: "600" }}
                >
                  Saving...
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={C.white} />
                <Text
                  style={{ color: C.white, fontSize: 16, fontWeight: "600" }}
                >
                  Save Expense
                </Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
