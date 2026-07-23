/**
 * App-level error modal (not used for pi agent timeline failures).
 * Built on shadcn AlertDialog.
 */
import { useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ErrorDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onClose: () => void;
  testId?: string;
}) {
  const settledRef = useRef(false);
  if (!props.message) return null;

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (open) {
          settledRef.current = false;
          return;
        }
        if (!settledRef.current) props.onClose();
      }}
    >
      <AlertDialogContent
        size="default"
        className="max-w-sm gap-3 p-4"
        data-testid={props.testId ?? "error-dialog"}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[15px] font-semibold">{props.title}</AlertDialogTitle>
          <AlertDialogDescription
            className="text-[13px] leading-relaxed whitespace-pre-wrap"
            data-testid="error-dialog-message"
          >
            {props.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            data-testid="error-dialog-confirm"
            onClick={() => {
              settledRef.current = true;
              props.onClose();
            }}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
