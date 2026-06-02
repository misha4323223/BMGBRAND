import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";

interface Suggestion {
  value: string;
  unrestricted_value: string;
  data: {
    postal_code?: string;
    city?: string;
    region?: string;
    street?: string;
    house?: string;
  };
}

interface DadataAddressInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
  "data-testid"?: string;
  className?: string;
}

export function DadataAddressInput({
  value,
  onChange,
  placeholder = "Начните вводить адрес...",
  required,
  id,
  "data-testid": testId,
  className,
}: DadataAddressInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
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
      const res = await fetch("/api/dadata/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, count: 7 }),
      });
      const data = await res.json();
      const items: Suggestion[] = data.suggestions || [];
      setSuggestions(items);
      setOpen(items.length > 0);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 300);
  };

  const handleSelect = (s: Suggestion) => {
    onChange(s.unrestricted_value || s.value);
    setSuggestions([]);
    setOpen(false);
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
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10 pointer-events-none" />
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
        className={`pl-10 ${className || ""}`}
        data-testid={testId}
        autoComplete="off"
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
              <span className="font-medium text-foreground line-clamp-1">{s.value}</span>
              {s.unrestricted_value !== s.value && (
                <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5 block">{s.unrestricted_value}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
