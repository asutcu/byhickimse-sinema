"use client";

import { Label } from "@/components/ui/label";
import { type LongformImageProvider } from "@/lib/longform-catalog";
import { FlowImageModelField } from "@/components/flow-image-model-field";

/**
 * Resim kaynagi tektir: Flow. Model secilebilir (Nano Banana 2 / Pro) —
 * Pro'nun kota/limiti dolunca 2'ye gecmek icin kullanicinin elle degistirmesi
 * gerekmesin diye burada birak.
 */
export function LongformImageSourcePicker({
  model,
  onChange,
}: {
  provider?: LongformImageProvider;
  model: string;
  onChange: (next: { imageProvider: LongformImageProvider; imageModel: string }) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Görsel kaynağı</Label>
        <div className="mt-1.5 rounded-[12px] border border-primary bg-primary-soft/40 px-3 py-2.5 ring-1 ring-primary/30">
          <div className="text-[13px] font-semibold">Flow</div>
          <div className="mt-0.5 text-[10.5px] text-muted leading-snug">{model} · Chrome açık</div>
        </div>
      </div>
      <FlowImageModelField
        value={model}
        onChange={(imageModel) => onChange({ imageProvider: "flow", imageModel })}
      />
    </div>
  );
}
