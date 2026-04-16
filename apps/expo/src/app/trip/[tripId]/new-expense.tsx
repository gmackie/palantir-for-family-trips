import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { trpc } from "~/utils/api";
import { getBaseUrl } from "~/utils/base-url";
import { authClient } from "~/utils/auth";
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

export default function NewExpense() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);

  // Form state
  const [merchant, setMerchant] = useState("");
  const [subtotalCents, setSubtotalCents] = useState("");
  const [taxCents, setTaxCents] = useState("");
  const [tipCents, setTipCents] = useState("");
  const [totalCents, setTotalCents] = useState("");

  // Get segments for this trip to pick the first one
  const { data: segments } = useQuery(
    trpc.trips.listSegments.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const createExpense = useMutation(
    trpc.expenses.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.expenses.list.queryFilter(),
        );
        router.back();
      },
      onError: (err) => {
        Alert.alert("Error", err.message);
      },
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
        const data = (await response.json()) as OcrResult;
        setOcrResult(data);
        // Pre-fill form from OCR
        if (data.merchant) setMerchant(data.merchant);
        if (data.subtotalCents != null)
          setSubtotalCents(String(data.subtotalCents));
        if (data.taxCents != null) setTaxCents(String(data.taxCents));
        if (data.tipCents != null) setTipCents(String(data.tipCents));
        if (data.totalCents != null) setTotalCents(String(data.totalCents));
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const parseCents = (value: string) => {
    const num = Number.parseInt(value, 10);
    return Number.isNaN(num) ? 0 : num;
  };

  const handleSubmit = () => {
    const segmentId = segments?.[0]?.id;
    if (!segmentId) {
      Alert.alert("Error", "No trip segment found. Cannot create expense.");
      return;
    }
    if (!merchant.trim()) {
      Alert.alert("Error", "Merchant name is required.");
      return;
    }

    createExpense.mutate({
      workspaceId,
      tripId: tripId ?? "",
      segmentId,
      merchant: merchant.trim(),
      occurredAt: new Date().toISOString(),
      subtotalCents: parseCents(subtotalCents),
      taxCents: parseCents(taxCents),
      tipCents: parseCents(tipCents),
      totalCents: parseCents(totalCents),
    });
  };

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "New Expense" }} />
      <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">
        {/* Receipt photo section */}
        <View className="mb-6">
          <Text className="text-foreground mb-3 text-lg font-semibold">
            Receipt Photo
          </Text>
          <View className="flex-row gap-3">
            <Pressable
              onPress={() => void handleTakePhoto()}
              className="bg-primary flex-1 items-center rounded-md px-4 py-3"
              style={{ minHeight: 48 }}
            >
              <Text className="text-primary-foreground font-medium">
                Take Photo
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void handlePickPhoto()}
              className="border-border flex-1 items-center rounded-md border px-4 py-3"
              style={{ minHeight: 48 }}
            >
              <Text className="text-foreground font-medium">
                Choose from Library
              </Text>
            </Pressable>
          </View>

          {uploading && (
            <View className="mt-3 flex-row items-center gap-2">
              <ActivityIndicator size="small" />
              <Text className="text-muted-foreground text-sm">
                Uploading and scanning receipt...
              </Text>
            </View>
          )}

          {photoUri && (
            <Image
              source={{ uri: photoUri }}
              className="mt-3 h-48 w-full rounded-lg"
              resizeMode="cover"
            />
          )}
        </View>

        {/* Expense form */}
        <View className="gap-4">
          <View>
            <Text className="text-foreground mb-1 text-sm font-medium">
              Merchant
            </Text>
            <TextInput
              className="border-input bg-background text-foreground rounded-md border px-3 py-3 text-base"
              value={merchant}
              onChangeText={setMerchant}
              placeholder="Restaurant name, store, etc."
              placeholderTextColor="#888"
            />
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-foreground mb-1 text-sm font-medium">
                Subtotal (cents)
              </Text>
              <TextInput
                className="border-input bg-background text-foreground rounded-md border px-3 py-3 font-mono text-base"
                value={subtotalCents}
                onChangeText={setSubtotalCents}
                placeholder="0"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
            </View>
            <View className="flex-1">
              <Text className="text-foreground mb-1 text-sm font-medium">
                Tax (cents)
              </Text>
              <TextInput
                className="border-input bg-background text-foreground rounded-md border px-3 py-3 font-mono text-base"
                value={taxCents}
                onChangeText={setTaxCents}
                placeholder="0"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
            </View>
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-foreground mb-1 text-sm font-medium">
                Tip (cents)
              </Text>
              <TextInput
                className="border-input bg-background text-foreground rounded-md border px-3 py-3 font-mono text-base"
                value={tipCents}
                onChangeText={setTipCents}
                placeholder="0"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
            </View>
            <View className="flex-1">
              <Text className="text-foreground mb-1 text-sm font-medium">
                Total (cents)
              </Text>
              <TextInput
                className="border-input bg-background text-foreground rounded-md border px-3 py-3 font-mono text-base"
                value={totalCents}
                onChangeText={setTotalCents}
                placeholder="0"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* OCR line items preview */}
          {ocrResult?.lineItems && ocrResult.lineItems.length > 0 && (
            <View className="border-border rounded-lg border p-3">
              <Text className="text-foreground mb-2 text-sm font-semibold">
                Detected Line Items
              </Text>
              {ocrResult.lineItems.map((item, i) => (
                <View
                  key={`${item.name}-${i}`}
                  className="mb-1 flex-row items-center justify-between"
                >
                  <Text className="text-foreground text-sm">{item.name}</Text>
                  <Text className="text-muted-foreground font-mono text-sm">
                    {item.lineTotalCents}c
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={createExpense.isPending}
            className="bg-primary mb-8 items-center rounded-md px-4 py-4"
            style={{ minHeight: 48 }}
          >
            {createExpense.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-primary-foreground font-semibold">
                Create Expense
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
