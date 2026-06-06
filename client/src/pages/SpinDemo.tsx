import SpinViewer from "@/components/SpinViewer";

const FRAMES = [
  "/spin-front.webp",
  "/spin-right.webp",
  "/spin-back.webp",
  "/spin-left.webp",
];

export default function SpinDemo() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">360° просмотр товара</h1>
        <p className="text-sm text-gray-500">Наведи для паузы · Потяни влево/вправо для ручного вращения</p>
      </div>

      <div className="w-full max-w-sm aspect-square">
        <SpinViewer frames={FRAMES} fps={8} className="w-full h-full" />
      </div>

      <div className="w-full max-w-sm">
        <p className="text-xs text-center text-gray-400">На мобиле — тяни пальцем</p>
      </div>
    </div>
  );
}
