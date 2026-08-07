import { Suspense } from "react"
import { DeliveryHub } from "@/components/delivery/delivery-hub"

export default function DeliveryPage() {
  return (
    <Suspense fallback={<div className="p-4"><div className="ui-meta">Loading...</div></div>}>
      <DeliveryHub />
    </Suspense>
  )
}
