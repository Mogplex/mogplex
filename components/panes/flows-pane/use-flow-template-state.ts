import { useState } from "react";
import type { PersonalFlowTemplate } from "@/lib/types";

export type TemplateDeleteTarget = {
  template: PersonalFlowTemplate;
  scope: "personal" | "team";
};

export type FlowTemplateState = {
  templatePickerOpen: boolean;
  setTemplatePickerOpen: (open: boolean) => void;
  saveTemplateOpen: boolean;
  setSaveTemplateOpen: (open: boolean) => void;
  saveTemplateName: string;
  setSaveTemplateName: (name: string) => void;
  saveTemplateScope: "personal" | "team";
  setSaveTemplateScope: (scope: "personal" | "team") => void;
  savingTemplate: boolean;
  setSavingTemplate: (saving: boolean) => void;
  templateDeleteTarget: TemplateDeleteTarget | null;
  setTemplateDeleteTarget: (target: TemplateDeleteTarget | null) => void;
  deletingTemplate: boolean;
  setDeletingTemplate: (deleting: boolean) => void;
};

/**
 * Manages state for the flow template picker, saving templates,
 * and deleting templates.
 */
export function useFlowTemplateState(): FlowTemplateState {
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateScope, setSaveTemplateScope] = useState<
    "personal" | "team"
  >("personal");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateDeleteTarget, setTemplateDeleteTarget] =
    useState<TemplateDeleteTarget | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState(false);

  return {
    templatePickerOpen,
    setTemplatePickerOpen,
    saveTemplateOpen,
    setSaveTemplateOpen,
    saveTemplateName,
    setSaveTemplateName,
    saveTemplateScope,
    setSaveTemplateScope,
    savingTemplate,
    setSavingTemplate,
    templateDeleteTarget,
    setTemplateDeleteTarget,
    deletingTemplate,
    setDeletingTemplate,
  };
}
