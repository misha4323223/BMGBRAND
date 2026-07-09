/// <reference types="vite/client" />

// export {} makes this file a module so that `declare module "react"` below
// AUGMENTS the existing module instead of replacing it (ambient module override).
export {};

// fetchpriority is a standard HTML attribute (Fetch Priority API) but is not yet
// included in @types/react's ImgHTMLAttributes. Extend it here so all <img>
// usages with fetchpriority="high|low|auto" compile without errors.
declare module "react" {
  interface ImgHTMLAttributes<T> {
    fetchpriority?: "high" | "low" | "auto";
  }
}
