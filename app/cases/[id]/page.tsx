"use client";

import { use } from "react";
import { CaseDetail } from "./case-detail";

export default function CasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <CaseDetail caseId={id} />;
}
