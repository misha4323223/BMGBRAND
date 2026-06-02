import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import rustoreLogo from "@assets/rustore-logo-color.svg";
import rustoreIcon from "@assets/rustore-icon.svg";

const RUSTORE_URL =
  "https://www.rustore.ru/catalog/app/ru.booomerangs.mobile";

interface RuStoreButtonProps {
  variant: "mobile" | "desktop";
}

export function RuStoreButton({ variant }: RuStoreButtonProps) {
  const [qrSvg, setQrSvg] = useState<string>("");

  useEffect(() => {
    if (variant !== "desktop") return;
    QRCode.toString(RUSTORE_URL, {
      type: "svg",
      margin: 1,
      width: 180,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    })
      .then(setQrSvg)
      .catch(() => setQrSvg(""));
  }, [variant]);

  if (variant === "mobile") {
    return (
      <a
        href={RUSTORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="relative p-1.5 hover:bg-muted rounded-full transition-colors group"
        aria-label="Скачать приложение в RuStore"
        data-testid="link-rustore-mobile"
      >
        <img
          src={rustoreIcon}
          alt="RuStore"
          className="w-5 h-5 rounded-[5px]"
          width="20"
          height="20"
        />
        <span
          aria-hidden="true"
          className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#0077FF] ring-2 ring-background animate-pulse"
        />
      </a>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-border/60 hover:bg-muted hover:border-border transition-colors group"
          aria-label="Скачать приложение в RuStore"
          data-testid="button-rustore-desktop"
        >
          <img
            src={rustoreLogo}
            alt="RuStore"
            className="h-5 w-auto"
            loading="lazy"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64 bg-card/95 backdrop-blur-2xl border border-border/50 shadow-xl rounded-2xl overflow-hidden p-0"
      >
        <div className="px-4 py-4 border-b border-border/40 flex items-center justify-center">
          <img src={rustoreLogo} alt="RuStore" className="h-7 w-auto" />
        </div>
        <div className="px-4 pt-4 pb-3 flex flex-col items-center gap-3">
          <div
            className="w-44 h-44 bg-white rounded-xl p-2 flex items-center justify-center"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
            data-testid="qr-rustore"
          />
          <p className="text-xs text-foreground/70 text-center leading-snug">
            Наведите камеру телефона
            <br />
            или нажмите кнопку ниже
          </p>
        </div>
        <div className="px-3 pb-3">
          <a
            href={RUSTORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center px-4 py-2.5 rounded-xl bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
            data-testid="link-rustore-open"
          >
            Открыть в RuStore
          </a>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
