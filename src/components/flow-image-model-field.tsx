"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FLOW_IMAGE_MODELS, resolveFlowImageModel } from "@/lib/flow-generation-settings";

export function FlowImageModelField({
  value,
  onChange,
  label = "Flow görsel modeli",
}: {
  value: string;
  onChange: (model: string) => void;
  label?: string;
}) {
  const selected = resolveFlowImageModel(value);
  const models = React.useMemo(() => {
    const list: string[] = [...FLOW_IMAGE_MODELS];
    if (value && !list.includes(value) && !list.includes(selected)) list.unshift(value);
    return list;
  }, [value, selected]);

  return (
    <div>
      <Label>{label}</Label>
      <Select value={selected} onValueChange={onChange}>
        <SelectTrigger className="mt-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
        Karakter görselleri, klip kareleri ve kapaklar bu modelle üretilir. Pro kotası dolarsa Nano Banana 2&apos;ye
        geçin.
      </p>
    </div>
  );
}
