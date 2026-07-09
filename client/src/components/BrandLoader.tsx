import { cn } from "@/lib/utils";

interface BrandLoaderProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const wordmarkTextClasses = {
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-5xl sm:text-6xl lg:text-7xl"
};

// Scatter offsets for each letter of "BOOOMERANGS" — distinct direction/rotation per letter
// so they fly apart and reassemble rather than moving uniformly.
const LETTER_SCATTER = [
  { dx: "-70px", dy: "-40px", dr: "-45deg" },
  { dx: "55px", dy: "-60px", dr: "35deg" },
  { dx: "-45px", dy: "55px", dr: "60deg" },
  { dx: "75px", dy: "25px", dr: "-30deg" },
  { dx: "-75px", dy: "10px", dr: "25deg" },
  { dx: "30px", dy: "-75px", dr: "-60deg" },
  { dx: "-30px", dy: "65px", dr: "45deg" },
  { dx: "65px", dy: "-20px", dr: "-25deg" },
  { dx: "-55px", dy: "-65px", dr: "50deg" },
  { dx: "45px", dy: "45px", dr: "-40deg" },
  { dx: "-65px", dy: "20px", dr: "35deg" },
];

function AnimatedWordmark({ size }: { size: "sm" | "md" | "lg" }) {
  const letters = "BOOOMERANGS".split("");
  return (
    <div
      className={cn("flex font-extrabold uppercase select-none", wordmarkTextClasses[size])}
      style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.02em" }}
      role="img"
      aria-label="BOOOMERANGS"
      data-testid="brand-loader"
    >
      {letters.map((ch, i) => {
        const scatter = LETTER_SCATTER[i % LETTER_SCATTER.length];
        return (
          <span
            key={i}
            className="animate-letter-assemble"
            style={{
              "--dx": scatter.dx,
              "--dy": scatter.dy,
              "--dr": scatter.dr,
              "--i": i,
            } as React.CSSProperties}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
}

export function BrandLoader({ className, size = "md", showText = true }: BrandLoaderProps) {
  if (!showText) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center justify-center", className)}>
      <AnimatedWordmark size={size} />
    </div>
  );
}

export function ImageLoader({ className }: { className?: string }) {
  return (
    <div className={cn("absolute inset-0 flex items-center justify-center bg-muted/30", className)} data-testid="image-loader">
      <div className="w-6 h-6 border-2 border-muted-foreground/20 border-t-muted-foreground/60 rounded-full animate-spin" />
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background" data-testid="page-loader">
      <BrandLoader size="lg" />
    </div>
  );
}
