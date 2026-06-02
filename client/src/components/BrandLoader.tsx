import { cn } from "@/lib/utils";

interface BrandLoaderProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const logoSizeClasses = {
  sm: "h-20",
  md: "h-32",
  lg: "h-52 sm:h-64 lg:h-80"
};

export function BrandLoader({ className, size = "md", showText = true }: BrandLoaderProps) {
  if (!showText) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center justify-center", className)} data-testid="brand-loader">
      <img
        src="/images/boomerangs-logo.webp"
        alt="BOOOMERANGS"
        className={cn("w-auto object-contain animate-brand-slide-up select-none", logoSizeClasses[size])}
      />
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
