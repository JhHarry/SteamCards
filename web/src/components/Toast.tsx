import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { Toast, ToastTone } from "../hooks/useValuation";

const TONE_META: Record<
  ToastTone,
  { color: string; background: string; Icon: typeof Info }
> = {
  success: { color: "var(--ok)", background: "var(--ok-soft)", Icon: CheckCircle2 },
  info: { color: "var(--info)", background: "var(--info-soft)", Icon: Info },
  warn: { color: "var(--warn)", background: "var(--warn-soft)", Icon: AlertTriangle },
  error: { color: "var(--danger)", background: "var(--danger-soft)", Icon: XCircle },
};

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-10 right-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => {
        const meta = TONE_META[toast.tone];
        const Icon = meta.Icon;
        return (
          <div
            key={toast.id}
            className="toast-in panel panel-strong pointer-events-auto flex items-start gap-2.5 p-3"
            role="status"
          >
            <span
              className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg"
              style={{ background: meta.background, color: meta.color }}
            >
              <Icon size={14} />
            </span>
            <div className="min-w-0 flex-1">
              {toast.title && (
                <div
                  className="text-[12px] font-semibold leading-tight"
                  style={{ color: "var(--text)" }}
                >
                  {toast.title}
                </div>
              )}
              <div
                className="mt-0.5 break-words text-[11.5px] leading-snug"
                style={{ color: "var(--text-secondary)" }}
              >
                {toast.message}
              </div>
            </div>
            <button
              type="button"
              className="btn-ghost -mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md"
              onClick={() => onDismiss(toast.id)}
              aria-label="关闭通知"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
