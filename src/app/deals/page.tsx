import type { Metadata } from "next";
import DealRoomDemo from "@/components/deals/DealRoomDemo";

export const metadata: Metadata = {
  title: "Property Deal Room Demo | RAQBO",
  description:
    "Preview a direct buyer-to-owner property journey with in-site messages, offers, viewings, and clear document-check stages.",
};

export default function DealsPage() {
  return <DealRoomDemo />;
}
