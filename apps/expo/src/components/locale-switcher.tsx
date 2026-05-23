import type { Locale } from "@gmacko/i18n/native";
import {
  supportedLocales,
  useLocaleNative,
  useTranslationsNative,
} from "@gmacko/i18n/native";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { setLocale } from "~/utils/i18n";

const C = {
  bg: "#141116",
  fg: "#f9f7fb",
  muted: "#8c8691",
  border: "#2f2a33",
  primary: "#d66daa",
  primaryFg: "#141116",
  primaryBg: "rgba(214,109,170,0.1)",
} as const;

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  es: "Espanol",
  fr: "Francais",
  de: "Deutsch",
  ja: "Japanese",
  zh: "Chinese",
};

interface LocaleSwitcherProps {
  onLocaleChange?: (locale: string) => void;
}

export function LocaleSwitcher({ onLocaleChange }: LocaleSwitcherProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const currentLocale = useLocaleNative();
  const t = useTranslationsNative();

  const handleLocaleChange = async (locale: Locale) => {
    await setLocale(locale);
    onLocaleChange?.(locale);
    setModalVisible(false);
  };

  return (
    <View>
      <Pressable
        onPress={() => setModalVisible(true)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.bg,
          borderRadius: 8,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Text style={{ color: C.fg }}>{t("common.selectLanguage")}</Text>
        <Text style={{ color: C.muted }}>
          {LOCALE_LABELS[currentLocale] ?? currentLocale.toUpperCase()}
        </Text>
      </Pressable>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
          onPress={() => setModalVisible(false)}
        >
          <View
            style={{
              backgroundColor: C.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 16,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <Text style={{ color: C.fg, fontSize: 20, fontWeight: "600" }}>
                {t("common.selectLanguage")}
              </Text>
              <Pressable onPress={() => setModalVisible(false)}>
                <Text style={{ color: C.primary }}>{t("common.close")}</Text>
              </Pressable>
            </View>

            <View style={{ gap: 4 }}>
              {supportedLocales.map((locale) => {
                const active = currentLocale === locale;
                return (
                  <Pressable
                    key={locale}
                    onPress={() => void handleLocaleChange(locale)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderRadius: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      backgroundColor: active ? C.primaryBg : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 16,
                        color: active ? C.primary : C.fg,
                        fontWeight: active ? "600" : "400",
                      }}
                    >
                      {LOCALE_LABELS[locale] ?? locale.toUpperCase()}
                    </Text>
                    {active && <Text style={{ color: C.primary }}>✓</Text>}
                  </Pressable>
                );
              })}
            </View>

            <View style={{ marginTop: 16, height: 32 }} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function LocaleButtonGroup({ onLocaleChange }: LocaleSwitcherProps) {
  const currentLocale = useLocaleNative();

  const handleLocaleChange = async (locale: Locale) => {
    await setLocale(locale);
    onLocaleChange?.(locale);
  };

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {supportedLocales.map((locale) => {
        const active = currentLocale === locale;
        return (
          <Pressable
            key={locale}
            onPress={() => void handleLocaleChange(locale)}
            style={{
              backgroundColor: active ? C.primary : C.bg,
              borderWidth: active ? 0 : 1,
              borderColor: C.border,
              borderRadius: 6,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: active ? C.primaryFg : C.fg }}>
              {locale.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
