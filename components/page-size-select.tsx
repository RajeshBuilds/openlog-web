"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PageSizeSelect({
  pageSize,
  options,
  defaultSize,
}: {
  pageSize: number;
  options: number[];
  defaultSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (Number(value) === defaultSize) params.delete("size");
    else params.set("size", value);
    // Row count changes the offsets, so go back to the first page.
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:block">
        Rows per page
      </span>
      <Select
        value={String(pageSize)}
        onValueChange={(value) => onChange(value as string)}
      >
        <SelectTrigger size="sm" className="w-16 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
