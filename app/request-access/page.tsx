import { permanentRedirect } from "next/navigation";

export default function RequestAccessPage() {
  permanentRedirect("/pricing");
}
