import ReceiptWizard from "@/components/ReceiptWizard";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-2 mb-12 text-center">
        <h1 className="text-2xl font-bold tracking-tight font-mono">
          Le Guide
        </h1>
        <p className="text-foreground/30 text-xs font-mono">
          Brought to you by 見えない技術クラウド
        </p>
      </div>

      <ReceiptWizard />
    </main>
  );
}
