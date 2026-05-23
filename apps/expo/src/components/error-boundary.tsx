import { integrations } from "@gmacko/config";
import { captureExceptionNative } from "@gmacko/monitoring/native";
import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { Pressable, Text, View } from "react-native";

const C = {
  bg: "#141116",
  fg: "#f9f7fb",
  muted: "#8c8691",
  border: "#2f2a33",
  primary: "#d66daa",
  primaryFg: "#141116",
  danger: "#ef4444",
  dangerBg: "rgba(239,68,68,0.1)",
  codeBg: "#1e1b24",
} as const;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (integrations.sentry) {
      captureExceptionNative(error);
    }

    console.error("ErrorBoundary caught an error:", error, errorInfo);

    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorScreen error={this.state.error} onRetry={this.handleReset} />
      );
    }

    return this.props.children;
  }
}

interface ErrorScreenProps {
  error: Error | null;
  onRetry?: () => void;
  onReport?: () => void;
}

export function ErrorScreen({ error, onRetry, onReport }: ErrorScreenProps) {
  const handleReport = () => {
    if (onReport) {
      onReport();
    } else if (integrations.sentry && error) {
      captureExceptionNative(error);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: C.dangerBg,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          <Text style={{ fontSize: 32 }}>!</Text>
        </View>

        <Text
          style={{
            color: C.fg,
            fontSize: 24,
            fontWeight: "bold",
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          Something went wrong
        </Text>

        <Text
          style={{
            color: C.muted,
            fontSize: 16,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          We're sorry, but something unexpected happened. Please try again.
        </Text>

        {__DEV__ && error && (
          <View
            style={{
              backgroundColor: C.codeBg,
              borderRadius: 8,
              padding: 16,
              width: "100%",
              marginBottom: 24,
            }}
          >
            <Text
              style={{
                color: C.danger,
                fontFamily: "Menlo",
                fontSize: 14,
                fontWeight: "600",
                marginBottom: 4,
              }}
            >
              {error.name}: {error.message}
            </Text>
            {error.stack && (
              <Text
                style={{
                  color: C.muted,
                  fontFamily: "Menlo",
                  fontSize: 12,
                }}
                numberOfLines={5}
              >
                {error.stack}
              </Text>
            )}
          </View>
        )}

        <View style={{ width: "100%", gap: 12 }}>
          {onRetry && (
            <Pressable
              onPress={onRetry}
              style={{
                backgroundColor: C.primary,
                width: "100%",
                alignItems: "center",
                borderRadius: 8,
                paddingVertical: 16,
              }}
            >
              <Text
                style={{ color: C.primaryFg, fontSize: 16, fontWeight: "600" }}
              >
                Try Again
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleReport}
            style={{
              borderWidth: 1,
              borderColor: C.border,
              width: "100%",
              alignItems: "center",
              borderRadius: 8,
              paddingVertical: 16,
            }}
          >
            <Text style={{ color: C.fg, fontSize: 16 }}>Report Issue</Text>
          </Pressable>
        </View>

        {integrations.sentry && (
          <Text
            style={{
              color: C.muted,
              fontSize: 12,
              textAlign: "center",
              marginTop: 16,
            }}
          >
            This error has been automatically reported to our team.
          </Text>
        )}
      </View>
    </View>
  );
}

export default ErrorBoundary;
