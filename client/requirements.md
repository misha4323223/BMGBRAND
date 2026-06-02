## Packages
framer-motion | Smooth page transitions and complex animations for the "edgy" feel
lucide-react | Iconography
clsx | Class name conditional logic
tailwind-merge | Class merging for components

## Notes
Tailwind Config - extend fontFamily:
fontFamily: {
  sans: ["'Inter'", "sans-serif"],
  display: ["'Oswald'", "sans-serif"], // Bold, condensed font for headlines
  mono: ["'JetBrains Mono'", "monospace"], // Technical feel
}

Store session ID in localStorage 'bmg_session_id' on app init if not present.
Cart logic should check this session ID.
Dark mode is the default and primary aesthetic.
