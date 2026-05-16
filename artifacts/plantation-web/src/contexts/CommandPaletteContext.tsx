import { createContext, useContext, useState, type ReactNode } from "react";

export type GlobalPaletteAction = "financial_entry" | "stock_movement" | null;

type CommandPaletteContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  pendingAction: GlobalPaletteAction;
  triggerAction: (action: GlobalPaletteAction) => void;
  clearAction: () => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: false,
  setOpen: () => {},
  pendingAction: null,
  triggerAction: () => {},
  clearAction: () => {},
});

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<GlobalPaletteAction>(null);

  function triggerAction(action: GlobalPaletteAction) {
    setOpen(false);
    setPendingAction(action);
  }

  function clearAction() {
    setPendingAction(null);
  }

  return (
    <CommandPaletteContext.Provider
      value={{ open, setOpen, pendingAction, triggerAction, clearAction }}
    >
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}
