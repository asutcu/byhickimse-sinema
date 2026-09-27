"use client";

import * as React from "react";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const NARRATION_NAME_MAX = 120;

export function normalizeNarrationName(value: string): string {
  return value.trim().slice(0, NARRATION_NAME_MAX);
}

/** Yeni anlatı formu — listenin ve stüdyonun göreceği ad. */
export function NarrationNameField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor="narration-name">Anlatı adı *</Label>
      <Input
        id="narration-name"
        value={value}
        maxLength={NARRATION_NAME_MAX}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value.slice(0, NARRATION_NAME_MAX))}
        placeholder="ör. Zehirler Olayı"
      />
      <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
        Anlatılar listesinde ve stüdyo başlığında bu ad görünür. Hikaye başlığından ayrıdır; sonra da değiştirebilirsin.
      </p>
    </div>
  );
}

/** Var olan anlatının adını yerinde değiştirir. */
export function EditableNarrationName({
  value,
  onSave,
  variant = "title",
  onEditingChange,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  variant?: "title" | "card";
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function setOpen(next: boolean) {
    setEditing(next);
    onEditingChange?.(next);
  }

  function start(event?: React.MouseEvent) {
    event?.stopPropagation();
    setDraft(value);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function cancel(event?: React.MouseEvent) {
    event?.stopPropagation();
    setDraft(value);
    setOpen(false);
  }

  async function save(event?: React.MouseEvent) {
    event?.stopPropagation();
    const next = normalizeNarrationName(draft);
    if (!next) {
      toast.error("Anlatı adı boş olamaz");
      return;
    }
    if (next === value) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div
        className={cn("flex items-center gap-1.5 min-w-0", variant === "title" && "max-w-xl")}
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          ref={inputRef}
          value={draft}
          maxLength={NARRATION_NAME_MAX}
          disabled={saving}
          aria-label="Anlatı adı"
          className={cn(variant === "title" && "h-11 font-display text-[22px] tracking-[-0.02em]")}
          onChange={(e) => setDraft(e.target.value.slice(0, NARRATION_NAME_MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={saving}
          onClick={cancel}
          aria-label="İptal"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          loading={saving}
          disabled={saving}
          onClick={(e) => void save(e)}
          aria-label="Kaydet"
        >
          <Check className="h-3.5 w-3.5 text-success" />
        </Button>
      </div>
    );
  }

  if (variant === "title") {
    return (
      <div className="flex items-center gap-2.5 min-w-0">
        <h1 className="font-display text-[34px] tracking-[-0.03em] leading-[1.05] truncate">{value}</h1>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={start}>
          <Pencil className="h-3.5 w-3.5" /> Adı değiştir
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      <button
        type="button"
        className="min-w-0 text-left text-[13.5px] font-semibold truncate hover:text-primary"
        onClick={start}
      >
        {value}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted hover:text-primary"
        onClick={start}
        aria-label="Adı değiştir"
        title="Adı değiştir"
      >
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  );
}
