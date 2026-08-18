"use client"

import type { ReactNode } from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { FlowStarterTemplateId } from "@/lib/flows/templates"
import type { PersonalFlowTemplate } from "@/lib/types"
import type { Installation } from "./types"
import {
  SaveTemplateButton,
  StarterTemplatesList,
  TemplatePickerHeader,
  TemplateSection,
} from "./template-picker"

export interface FlowTemplatePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  isCreating: boolean
  installations: Installation[]
  createInstallationId: string
  onCreateInstallationChange: (value: string) => void
  createRepository: string
  onCreateRepositoryChange: (value: string) => void
  createRepositoryOptions: Array<{ full_name: string }>
  personalTemplates: PersonalFlowTemplate[]
  personalTemplatesHaveMore: boolean
  personalTemplatesLoadingMore: boolean
  onLoadMorePersonalTemplates: () => void
  teamTemplates: PersonalFlowTemplate[]
  teamTemplatesHaveMore: boolean
  teamTemplatesLoadingMore: boolean
  onLoadMoreTeamTemplates: () => void
  teamTemplatesCanWrite: boolean
  savingTemplate: boolean
  selectedFlow: { id: string; name: string } | null
  activeTeamId: string | null
  onCreateFlow: (
    templateId: FlowStarterTemplateId | null,
    savedTemplate?: PersonalFlowTemplate,
    savedTemplateScope?: "personal" | "team",
  ) => void
  onDeleteTemplate: (template: PersonalFlowTemplate, scope: "personal" | "team") => void
  onSaveAsTemplate: () => void
}

export function FlowTemplatePicker({
  open,
  onOpenChange,
  trigger,
  side = "right",
  align = "start",
  isCreating,
  installations,
  createInstallationId,
  onCreateInstallationChange,
  createRepository,
  onCreateRepositoryChange,
  createRepositoryOptions,
  personalTemplates,
  personalTemplatesHaveMore,
  personalTemplatesLoadingMore,
  onLoadMorePersonalTemplates,
  teamTemplates,
  teamTemplatesHaveMore,
  teamTemplatesLoadingMore,
  onLoadMoreTeamTemplates,
  teamTemplatesCanWrite,
  savingTemplate,
  selectedFlow,
  activeTeamId,
  onCreateFlow,
  onDeleteTemplate,
  onSaveAsTemplate,
}: FlowTemplatePickerProps) {
  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      if (isCreating) return
      onOpenChange(nextOpen)
    }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={10}
        data-testid="flow-template-picker"
        className="flex max-h-[min(720px,calc(100vh-32px))] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden border-border bg-popover p-0 shadow-2xl"
      >
        <TemplatePickerHeader
          installations={installations}
          createInstallationId={createInstallationId}
          onCreateInstallationChange={onCreateInstallationChange}
          createRepositoryOptions={createRepositoryOptions}
          createRepository={createRepository}
          onCreateRepositoryChange={onCreateRepositoryChange}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {teamTemplates.length ? (
            <TemplateSection
              scope="team"
              templates={teamTemplates}
              hasMore={teamTemplatesHaveMore}
              loadingMore={teamTemplatesLoadingMore}
              onLoadMore={onLoadMoreTeamTemplates}
              isCreating={isCreating}
              createRepository={createRepository}
              canDelete={teamTemplatesCanWrite}
              onCreateFlow={(template) => onCreateFlow(null, template, "team")}
              onDeleteTemplate={(template) => onDeleteTemplate(template, "team")}
            />
          ) : null}
          {personalTemplates.length ? (
            <TemplateSection
              scope="personal"
              templates={personalTemplates}
              hasMore={personalTemplatesHaveMore}
              loadingMore={personalTemplatesLoadingMore}
              onLoadMore={onLoadMorePersonalTemplates}
              isCreating={isCreating}
              createRepository={createRepository}
              canDelete
              onCreateFlow={(template) => onCreateFlow(null, template, "personal")}
              onDeleteTemplate={(template) => onDeleteTemplate(template, "personal")}
            />
          ) : null}
          <StarterTemplatesList
            isCreating={isCreating}
            onCreateFlow={(templateId) => onCreateFlow(templateId)}
          />
        </div>
        <SaveTemplateButton
          selectedFlow={selectedFlow}
          savingTemplate={savingTemplate}
          activeTeamId={activeTeamId}
          teamTemplatesCanWrite={teamTemplatesCanWrite}
          onSaveAsTemplate={onSaveAsTemplate}
        />
      </PopoverContent>
    </Popover>
  )
}
