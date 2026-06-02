import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { FileText, Loader2 } from "lucide-react";

interface PartySuggestion {
  value: string;
  data: {
    inn: string;
    kpp?: string;
    name: {
      full_with_opf?: string;
      short_with_opf?: string;
    };
    address?: {
      unrestricted_value?: string;
      value?: string;
    };
    type: "LEGAL" | "INDIVIDUAL";
  };
}

interface DadataInnInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (data: { inn: string; kpp?: string; companyName?: string; legalAddress?: string }) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
  "data-testid"?: string;
}

export function DadataInnInput({
  value,
  onChange,
  onSelect,
  placeholder = "ИНН или название организации",
  required,
  id,
  "data-testid": testId,
}: DadataInnInputProps) {
  const [suggestions, setSuggestions] = useState<PartySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/dadata/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, count: 5 }),
      });
      const data = await res.json();
      const items: PartySuggestion[] = data.suggestions || [];
      setSuggestions(items);
      setOpen(items.length > 0);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, "");
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 300);
  };

  const handleSelect = (s: PartySuggestion) => {
    onChange(s.data.inn);
    setSuggestions([]);
    setOpen(false);
    if (onSelect) {
      onSelect({
        inn: s.data.inn,
        kpp: s.data.kpp,
        companyName: s.data.name.short_with_opf || s.data.name.full_with_opf || s.value,
        legalAddress: s.data.address?.unrestricted_value || s.data.address?.value,
      });
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10 pointer-events-none" />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin z-10 pointer-events-none" />
      )}
      <Input
        id={id}
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        required={required}
        maxLength={12}
        className="pl-10"
        data-testid={testId}
        autoComplete="off"
        inputMode="numeric"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors border-b border-border/50 last:border-0"
              onMouseDown={() => handleSelect(s)}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground line-clamp-1">
                  {s.data.name.short_with_opf || s.value}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">ИНН {s.data.inn}</span>
              </div>
              {s.data.address?.value && (
                <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5 block">
                  {s.data.address.value}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
