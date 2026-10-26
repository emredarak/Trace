import AddEvidenceForm from "./form";

export default async function AddEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AddEvidenceForm caseId={id} />;
}
