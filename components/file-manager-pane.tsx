"use client"
import { RulesSection } from "@/components/library/rules-section"

interface Props {
  type: "rules" | "skills"
}

export function FileManagerPane({ type }: Props) {
  if (type === "rules") {
    return <RulesSection compact />
  }
  // skills type is handled by SkillsPane directly
  return <RulesSection compact />
}
