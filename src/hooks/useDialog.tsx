/**
 * Imperative confirm/alert dialog API.
 *
 * Replaces the `window.alert(...)` and `window.confirm(...)` calls scattered
 * through the app with a styled, brutalist-themed dialog that matches the
 * rest of the UI and works on iOS (where the native browser dialogs are
 * acceptable but visually jarring against this design).
 *
 * Usage:
 *   // Wrap your app:
 *   <DialogProvider>
 *     <App />
 *   </DialogProvider>
 *
 *   // Anywhere inside:
 *   const dialog = useDialog();
 *   await dialog.alert({ title: "Couldn't save", body: err.message });
 *   const ok = await dialog.confirm({
 *     title: "Delete drawing",
 *     body: 'This can\'t be undone.',
 *     destructive: true,
 *   });
 *
 * Implementation:
 *   The provider owns a queue of one open dialog at a time (the second call
 *   resolves immediately when the first is still open — practical UX trade,
 *   matches how window.confirm() blocks). Each call returns a Promise that
 *   resolves when the user closes the dialog.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { AlertDialog } from "../components/AlertDialog";

export interface ConfirmOptions {
  title: string;
  body: string;
  subtitle?: string;
  okLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface AlertOptions {
  title: string;
  body: string;
  okLabel?: string;
}

export interface DialogApi {
  /** Returns true if the user confirmed, false if they cancelled. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Returns when the user dismisses the alert. */
  alert: (options: AlertOptions | string) => Promise<void>;
}

interface PendingConfirm extends ConfirmOptions {
  kind: "confirm";
  resolve: (ok: boolean) => void;
}
interface PendingAlert extends AlertOptions {
  kind: "alert";
  resolve: () => void;
}
type Pending = PendingConfirm | PendingAlert;

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          // If a dialog is already open, resolve the new one immediately as
          // cancel — matches window.confirm()'s blocking semantics from a
          // call-site perspective.
          if (prev !== null) {
            resolve(false);
            return prev;
          }
          return { kind: "confirm", ...options, resolve };
        });
      }),
    [],
  );

  const alert = useCallback(
    (options: AlertOptions | string) =>
      new Promise<void>((resolve) => {
        const opts: AlertOptions =
          typeof options === "string"
            ? { title: "Notice", body: options }
            : options;
        setPending((prev) => {
          if (prev !== null) {
            resolve();
            return prev;
          }
          return { kind: "alert", ...opts, resolve };
        });
      }),
    [],
  );

  const api = useMemo<DialogApi>(() => ({ confirm, alert }), [confirm, alert]);

  const closeWith = (ok: boolean) => {
    setPending((prev) => {
      if (!prev) return null;
      if (prev.kind === "confirm") prev.resolve(ok);
      else prev.resolve();
      return null;
    });
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending?.kind === "confirm" && (
        <ConfirmDialog
          title={pending.title}
          subtitle={pending.subtitle}
          body={pending.body}
          okLabel={pending.okLabel}
          cancelLabel={pending.cancelLabel}
          destructive={pending.destructive}
          onConfirm={() => closeWith(true)}
          onCancel={() => closeWith(false)}
        />
      )}
      {pending?.kind === "alert" && (
        <AlertDialog
          title={pending.title}
          body={pending.body}
          okLabel={pending.okLabel}
          onClose={() => closeWith(false)}
        />
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error(
      "useDialog must be used inside a <DialogProvider>. Wrap your tree at the App root.",
    );
  }
  return ctx;
}
